import readline from 'readline';
import fs from 'fs';
import stream from 'stream';

export type TopologyField = string[];

export class ItpFile {
  protected data: { [itp_field: string]: TopologyField } = {};
  protected includes: string[] = [];

  protected static HEADLINE_KEY = '_____begin_____';
  static BLANK_REGEX = /\s+/;

  constructor(protected file: string | NodeJS.ReadableStream) {}

  /**
   * Read ITPs that contains multiple molecules.
   */
  static async readMany(file: string | NodeJS.ReadableStream) {
    const rl = readline.createInterface({
      input: typeof file === 'string' ? fs.createReadStream(file) : file,
      crlfDelay: Infinity,
    });

    let f = new ItpFile("");
    let initial = true;
    const files: ItpFile[] = [f];

    let field = ItpFile.HEADLINE_KEY;

    for await (const line of rl) {
      const trimmed = line.trim();

      if (!trimmed) {
        continue;
      }

      const match = trimmed.match(/^\[ *(\w+) *\]$/);
      if (match) {
        field = match[1].trim();

        // We switch molecule, creating new ITP if not in initial
        if (field === "moleculetype") {
          if (!initial) {
            f = new ItpFile("");
            files.push(f);
          }
          else {
            initial = false;
          }
        }
        continue;
      }

      if (trimmed.startsWith('#include')) {
        f.includes.push(trimmed);
      }

      if (field in f.data) 
        f.data[field].push(trimmed);
      else
        f.data[field] = [trimmed];
    }
  }

  static readFromString(data: string) {
    const f = new ItpFile("");
    let field = ItpFile.HEADLINE_KEY;

    for (const line of data.split('\n')) {
      const new_f = f.readLine(line, field);
      if (new_f) {
        field = new_f;
      }
    }

    return f;
  }

  async read() {
    const rl = readline.createInterface({
      input: typeof this.file === 'string' ? fs.createReadStream(this.file) : this.file,
      crlfDelay: Infinity,
    });

    let field = ItpFile.HEADLINE_KEY;

    for await (const line of rl) {
      const new_f = this.readLine(line, field);
      if (new_f) {
        field = new_f;
      }
    }
  }

  protected readLine(line: string, current_field: string) {
    const trimmed = line.trim();

    if (!trimmed) {
      return;
    }

    const match = trimmed.match(/^\[ *(\w+) *\]$/);
    if (match) {
      return match[1].trim();
    }

    if (trimmed.startsWith('#include')) {
      this.includes.push(trimmed);
    }

    if (current_field in this.data) 
      this.data[current_field].push(trimmed);
    else
      this.data[current_field] = [trimmed];
  }

  getField(name: string) {
    if (name in this.data)
      return this.data[name];
    return [];
  }

  setField(name: string, data: string[]) {
    this.data[name] = data;
  }

  get headlines() {
    return this.getField(ItpFile.HEADLINE_KEY);
  }

  get name_and_count() {
    const f = this.getField('moleculetype');

    if (!f.length) {
      return ["", 0];
    }

    const [name, count] = f[0].split(ItpFile.BLANK_REGEX);
    let n = Number(count);

    return [name, n];
  }

  get name() {
    return this.name_and_count[0];
  }

  get molecule_count() {
    return this.name_and_count[1];
  }

  get atoms() {
    return this.getField('atoms');
  }

  get bonds() {
    return this.getField('bonds');
  }

  get virtual_sites() {
    return this.getField('virtual_sitesn');
  }

  asReadStream() {
    const stm = new stream.Readable;

    setTimeout(async () => {
      for (const field in this.data) {
        if (field !== ItpFile.HEADLINE_KEY)
          stm.push(`[${field}]\n`);
  
        for (const line of this.data[field]) {
          stm.push(line + '\n');
        }

        await new Promise(resolve => setTimeout(resolve, 5));
      }

      stm.push(null);
    }, 5);

    return stm;
  }

  toString() {
    let str = "";
    for (const field in this.data) {
      if (field !== ItpFile.HEADLINE_KEY)
        str += `[${field}]\n`;

      for (const line of this.data[field]) {
        str += line + '\n';
      }
    }

    return str;
  }

  /**
   * Remove data from this ITP. You can't read it after this!
   */
  dispose() {
    this.data = {};
    this.includes = [];
  }
}

export class TopFile extends ItpFile {
  protected molecules: { [name: string]: ItpFile[] } = {};

  constructor(
    protected top_file: string | NodeJS.ReadableStream,
    protected itp_files: (string | NodeJS.ReadableStream)[],
  ) {
    super(top_file);
  }

  async read() {
    await super.read();

    const molecules = this.getField('molecules');
    const molecules_count: { [name: string]: number } = {};

    for (const line of molecules) {
      const [name, count] = line.split(TopFile.BLANK_REGEX);
      molecules_count[name] = Number(count);
    }

    for (const file of this.itp_files) {
      const itp = new ItpFile(file);
      await itp.read();

      const [name, count] = itp.name_and_count;

      if (!(name in molecules_count)) {
        // this molecule is not in the system
        continue;
      }

      if (!(name in this.molecules))
        this.molecules[name] = [];

      for (let i = 0; i < molecules_count[name]; i++) {
        this.molecules[name].push(itp);
      }
    }
  }

  getMolecule(name: string) {
    return this.molecules[name] ?? [];
  }

  get molecule_list() {
    return Object.entries(this.molecules);
  }

  get system() {
    return this.getField('system');
  }

  /**
   * Remove data from all itps included and top file.
   */
  dispose() {
    super.dispose();
    
    for (const itps of Object.values(this.molecules)) {
      for (const itp of itps) {
        itp.dispose();
      }
    }
  }
}

export default ItpFile;
