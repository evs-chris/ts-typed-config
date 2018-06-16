import * as fs from 'fs';
import * as ts from 'typescript';
import * as path from 'path';
import * as requireCwd from 'import-cwd';

export interface Options<T> {
  localSource: string;
  configFilePaths: string[];
  init?: T;
  reload?: () => T;
  result?: (FileResult) => void;
}

export interface InitOptions<T> extends Options<T> {
  init: T;
}

export interface ReloadOptions<T> extends Options<T> {
  reload: () => T;
}

export interface Config<T> {
  reload(): void;
  config: T;
}

export interface TSError {
  file: string;
  line: number;
  char: number;
  message: string;
  type: string;
  text: string;
}

export interface FileResult {
  name: string;
  exists: boolean;
  loaded: boolean;
  errors: TSError[];
  exception?: string;
}

export function config<T>(options: InitOptions<T> | ReloadOptions<T>): Config<T> {
  const localTS = options.localSource;

  try {
    fs.statSync(localTS);
  } catch (e) {
    throw new Error(`ts-typed-config definition file (${localTS}) must exist and be readable.`);
  }

  let config = options.init ? options.init : options.reload();
  
  function load(file): void {
    const mod = path.resolve(localTS).replace(/\.ts$/, '');
    let input = fs.readFileSync(file, { encoding: 'utf8' }).replace(/\$CONFIG/g, mod);
    if (!~input.indexOf(mod)) input += `\nimport { Config } from '${mod}';`
    input += `\ndeclare global { const config: Config; }`;

    const output = transform(file, input, localTS, {
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      lib: [ 'node', 'es2017' ],
      target: ts.ScriptTarget.ES2017
    });
    if (output.errors.length) {
      if (options.result) options.result({ name: file, exists: true, loaded: false, errors: output.errors });
    } else {
      const text: string = output.outputs.find(o => o.name.replace(/\.js$/, '.ts') === file).text;
      try {
        (new Function('exports', 'require', '__filename', '__dirname', 'config', text))({}, requireCwd, path.resolve(file), path.dirname(path.resolve(file)), config);
        if (options.result) options.result({ name: file, exists: true, loaded: true, errors: [] });
      } catch (e) {
        if (options.result) options.result({ name: file, exists: true, loaded: false, exception: e.message, errors: [] })
      }
    }
  }

  function reload() {
    if (options.reload) config = options.reload();
    options.configFilePaths.forEach(f => {
      try {
        fs.statSync(f);
        try { load(f); } catch (e) {}
      } catch (e) {
        if (options.result) options.result({ name: f, exists: false, loaded: false, errors: [] });
      }
    });
  }

  reload();

  return {
    reload,
    config
  };
}

interface TransformResult {
  outputs: TransformFile[];
  errors: TSError[];
}

interface TransformFile {
  name: string;
  text: string;
}

function transform(name: string, contents: string, localTS: string, compilerOptions: ts.CompilerOptions = {}): TransformResult {
  // Generated outputs
  var outputs: TransformFile[] = [];
  function fileExists(name) { return ts.sys.fileExists(name); }
  function readFile(name) { return ts.sys.readFile(name); }
  // Create a compilerHost object to allow the compiler to read and write files
  const compilerHost = {
    getSourceFile(filename, languageVersion) {
      let res: ts.SourceFile;
      if (filename === name)
        res = ts.createSourceFile(filename, contents, compilerOptions.target);
      else if (filename === 'es2017.d.ts') {
        res = ts.createSourceFile(filename, fs.readFileSync(require.resolve('typescript/lib/lib.es2017.d.ts'), { encoding: 'utf8' }), languageVersion);
      } else if (filename === 'node.d.ts') {
        res = ts.createSourceFile(filename, fs.readFileSync(require.resolve('@types/node/index.d.ts'), { encoding: 'utf8' }), languageVersion);
      } else if (filename === 'inspector.d.ts') {
        res = ts.createSourceFile(filename, fs.readFileSync(require.resolve('@types/node/inspector.d.ts'), { encoding: 'utf8' }), languageVersion);
      } else if (/lib\..*\.d\.ts/.test(filename)) {
        res = ts.createSourceFile(filename, fs.readFileSync(require.resolve(path.join('typescript/lib', filename)), { encoding: 'utf8' }), languageVersion);
      }
      else {
        const source = ts.sys.readFile(filename);
        res = source ? ts.createSourceFile(filename, source, languageVersion) : undefined;
      }
      return res;
    },
    writeFile(name, text) {
      outputs.push({ name: name, text: text });
    },
    fileExists,
    readFile,
    getDefaultLibFileName() { return ts.getDefaultLibFileName(compilerOptions); },
    getDirectories(path) { return ts.sys.getDirectories(path); },
    useCaseSensitiveFileNames() { return ts.sys.useCaseSensitiveFileNames; },
    getCanonicalFileName(filename) { return ts.sys.useCaseSensitiveFileNames ? filename : filename.toLowerCase() },
    getCurrentDirectory() { return ts.sys.getCurrentDirectory() },
    getNewLine() { return ts.sys.newLine; },
    resolveModuleNames(moduleNames: string[], containingFile: string): ts.ResolvedModule[] {
      const resolvedModules: ts.ResolvedModule[] = [];
      for (const moduleName of moduleNames) {
        // try to use standard resolution
        let result = ts.resolveModuleName(moduleName, containingFile === name ? localTS : containingFile, compilerOptions, { fileExists, readFile });
        if (result.resolvedModule) {
            resolvedModules.push(result.resolvedModule);
        } else {
          resolvedModules.push(undefined)
        }
      }
      return resolvedModules;
    }
  };
  // Create a program from inputs
  var program = ts.createProgram([name], compilerOptions, compilerHost);
  // Query for early errors
  var errors = program.getSyntacticDiagnostics(program.getSourceFile(name)).concat(program.getSemanticDiagnostics(program.getSourceFile(name)));
  // Do not generate code in the presence of early errors
  if (!errors.length) {
      // Type check and get semantic errors
      program.emit();
  }
  return {
    outputs,
    errors: errors.map(e => {
      const pos = e.file.getLineAndCharacterOfPosition(e.start);
      const starts = e.file.getLineStarts();
      return {
        file: e.file.fileName,
        line: pos.line + 1,
        char: pos.character + 1,
        message: e.messageText.toString(),
        text: e.file.getText().substring(starts[pos.line], starts[pos.line + 1] - 1),
        type: ts.DiagnosticCategory[e.category]
      };
    })
  };
}