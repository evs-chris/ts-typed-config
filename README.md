# ts-typed-config

If you prefer config files to env vars, like the benefits of typescript's type checking, and would like to have strongly typed, verifiable config files, then this module is probably for you.

This wraps up typescripts compiler API in such a way that you specify a source config definition consisting of a `Config` interface, a list of config files to pull in, an initial config state, and an optional result callback to handle logging and errors to execute your config files in a safe way against the initial state. Everything is synchronous, so you can safely reference config variables in other modules as long as your config module is the first thing you reference in your entry file.

### Why?

* Larger projects tend to have too many switches to fit entirely in env vars. There's nothing stopping you from using env vars in your config files too.
* Larger projects also tend to have many hands on them at different times. Having a documented and checked config format is nice for that sort of thing.
* Defaulting to dev mode in the project source and keeping sensitive/dangerous stuff sequestered on the production machine in the production user's home directory can make for significantly fewer 'oh crap' moments during development.
* Being able to pull in project deps and generally have the full power of the node environment available to a config is just ducky.
* BIC and I've been bitten by JSON-y config files that were missing pieces or had minor typos.

### Gotchas

* Since the module does some, uh, _things_, with the compiler API to make all of your project dependencies available to the config files, you don't get nice in-editor typechecking on the config files if you're using, for instance, vscode. Everything _is_ checked when the files are loaded and executed.
* This is effectively using `eval`, so if you can't trust your config files, don't use it.
* It's probably not the most performant and resource-conscious way to load a config file, seeing as it needs the full typescript compiler loaded.
* Loading the config is synchronous, so you're blocked until it's done. On the plus side, loading the config is synchronous, so you know it's _actually_ ready when any subsequent modules load.
* It's possible to do something silly, like reference project source from the config that also references the config, thus releasing Zalgo to bring Ragnarok upon Cthulhu's armageddon.

### Example

`src/config.ts`
```ts
import { Config } from './config-type';
import { config as readConfig } from '@evs-chris/ts-typed-config';
import * as path from 'path';

// everything will import { config } from './config'
export let config: Config = {};

const handle = readConfig({
  // config files we want to consider - missing files are ignored
  configFilePaths: [
    '/etc/mythingy/config.ts', // system-wide mythingy
    path.join(process.env.HOME, '.mythingy.config.ts') // my very own special mythingy
    // files are applied in order to the existing config object, and you can put them
    // wherever you want
  ],

  // if your config only has the Config interface in it and/or other type-only defs, you
  // can reference the ts source otherwise, you probably want to reference the compiled
  // file and make sure it has a companion definition file
  // __dirname can be your friend here as well
  localSource: path.resolve('./dist/config-type.js'),

  // the initial config object in case there are no config files - defaults
  // you could supply a reload function that returns a Config if you want to 
  // start fresh on any reloads - then init is optional, but at least one is required
  init: config,

  // the result callback is also optional, but it gives you an opportunity to handle
  // any errors in both syntax and execution of config files
  result(res) {
    // if the file loaded, say so
    if (f.loaded) {
      console.log(`Loaded config from ${res.name}`);
    }

    // if there were errors, pop 'em out - files with errors never load
    else if (f.errors.length) {
      console.error(f.errors.map(e => {
        return `${e.type}: ${e.file} - ${e.message
        }\n ${e.line}| ${e.text
        }\n ${Array.apply(Array, new Array(e.line.toString().length + e.char)).map(_ => ' ').join('')} ^`;
      }).join('\n'));
      
      // and bail
      process.exit(1);
    }

    // if there was an exception running the file
    else if (f.exception) {
      console.error(`Error: Exception loading config from ${f.name
      }\n  ${f.exception}`);
      process.exit(1);
    }
  }
});

// not strictly necessary, but if you want to pull in changes without punting the whole process
export function reload() {
  handle.reload();
}
```

`src/config-type.ts`
```ts
// you can feel free to import whatever here, as the import space is swizzled around
// such that it appears to typescript to be coming from the localSource during execution

// this is your main config interface/class/type
export interface Config {
  debug?: boolean;
  mailers?: {
    user?: MailConfig,
    system?: MailConfig
  };
  port?: number
}

export type MailConfig = MockMailConfig | ServerMailConfig;

export interface MockMailConfig {
  mock: true;
}

export interface ServerMailConfig {
  transport: string;
  server: string;
  user: string;
  password: string;
  port: number;
}
```

`~/.mythingy.config.ts`
```ts
// config is set up as a global for the scope of this code and will already have
// the defaults plus any prior config files/runs applied

// note that the Config type from your localSource is automatically imported
// if you need to import other things the special $CONFIG variable will be swapped with
// the path to the localSource file before the config is evaluated
// make sure that you also include the Config type if you do so e.g.
// import { Config, Other, Things } from '$CONFIG';

// this is my mythingy dev machine, and oogieboogie is always running on port 3000
config.port = 3001;

// give me all those sweet, sweet log messages on the console
config.debug = true;

// send system generated mail, but mock mail generated by user interaction
config.mailers = {
  user: { mock: true },
  system: {
    transport: 'gmail',
    server: 'mail.google.com',
    user: 'larry',
    password: 'totes not doing evil',
    port: 5454
  }
}
```

### Bare minimum example

If you just want the darn config loaded and don't care about anything else:

```ts
import { Config } from './config-type';
import { config as readConfig } from '@evs-chris/ts-typed-config';
import * as path from 'path';

export let config: Config = {};

readConfig({
  configFilePaths: [
    path.join(process.env.HOME, '.mythingy.config.ts'),
    '/etc/mythingy/config.ts'
  ],
  localSource: path.resolve('./dist/config-type.js'),
  init: config
});
```

### TODO

* [ ] Add a bin that can typecheck a config file before runtime, though that may require having a config config, which seems silly.