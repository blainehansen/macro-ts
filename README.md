# `macro-ts`

This project aims to fill the missing meta-programming gap in typescript.

Anyone who's used a statically typed language with a powerful and safe macro/meta-programming system knows that they are essential to truly unlock the full power of the language. Statically typed languages without meta-programming are simply too inflexible to be truly productive, and statically typed languages *with* meta-programming are unbelievably safe and productive.

You may be saying: but [typescript already has macros!](https://blog.logrocket.com/using-typescript-transforms-to-enrich-runtime-code-3fd2863221ed/) However, it's very important to notice that the transformation process allowed by the typescript compiler **don't typecheck the transformed output**. This makes them unsafe and not very useful.

[Mapped](https://www.typescriptlang.org/docs/handbook/advanced-types.html#mapped-types) and [Conditional](https://www.typescriptlang.org/docs/handbook/advanced-types.html#conditional-types) types can do some of the work that traditional macros would usually do, but they aren't nearly complete.

`macro-ts` attempts to solve that, at least in the short term. This project also adds some nice conveniences to using the compiler, and compiling for multiple simply defined targets.

## Quickstart

You can quickly run/check/build a file just by calling the command with an entry file or glob. This method is appropriate for rapid prototyping or experimentation, will use the `anywhere` compilation environment, and will try to load macros from a `.macro-ts.ts` file in the current working directory.

```bash
npx macro-ts run someScript.ts
npx macro-ts check 'someDir/**/*.ts'
npx macro-ts build 'someDir/**/*.ts'
```

When you want to create a proper project, create a `.macro-ts.toml` file to hold configuration specific to `macro-ts`.

```toml
# points to the file
# where your macros are defined
# this is the default
macros = '.macros.ts'

# entry globs and compilation environments
# for as many different directories as you want
[[packages]]
location = 'app'
entry = 'main.ts'
environment = 'modernbrowser'

[[packages]]
location = 'bin'
entry = '*.ts'
environment = 'node'

[[packages]]
location = 'lib'
entry = '**/*.ts'
exclude = '**/*.test.ts'
environment = 'anywhere'
```


## Compilation environments

In the javascript world, we almost always write code with one of these intended execution environments, which effects what ambient libraries typescript should include:

- `browser`: needs access to the various dom libraries and globals.
- `webworker`: needs access to the various webworker libraries and globals.
- `node`: needs access to the various node libraries and globals.
- `anywhere`: shouldn't assume the existence of *any* special libraries or globals.

Typescript has ways of including different type libraries for node and the browser, but they're a little clunky and inexact. `macro-ts` introduces the concept of compilation environments that allow you to easily choose the ambient types that should be available, as well as the typescript `target`.

There are five environment shorthands, which expand to an object of this type:

```ts
import ts = require('typescript')
type CompilationEnvironment = {
  platform: 'browser' | 'webworker' | 'node' | 'anywhere',
  target: ts.ScriptTarget,
};
```

- `legacybrowser`: `{ platform: 'browser', target: ts.ScriptTarget.ES5 }`
- `modernbrowser`: `{ platform: 'browser', target: ts.ScriptTarget.Latest }`
- `webworker`: `{ platform: 'webworker', target: ts.ScriptTarget.Latest }`
- `node`: `{ platform: 'node', target: ts.ScriptTarget.Latest }`
- `anywhere`: `{ platform: 'anywhere', target: ts.ScriptTarget.Latest }`


## cli useage

The `macro-ts` cli has these subcommands:


### `run entryFile.ts`

### `check entryFile.ts` or `check dir --exclude='node_modules' --exclude='*.test.ts'`

### `build entryFile.ts` or `build dir --exclude='node_modules' --exclude='*.test.ts'`


## Writing macros

Here's a simple macros file:

```ts
import { FunctionMacro, BlockMacro, DecoratorMacro, ImportMacro } from 'macro-ts'
export const macros = {
  f: FunctionMacro(/* ... */),
  b: BlockMacro(/* ... */),
  d: DecoratorMacro(/* ... */),
  i: ImportMacro(/* ... */),
}
```

The `macro-ts` cli expects the macros file to export a dictionary named `macros`. The `macro-ts` library provides the `FunctionMacro`, `BlockMacro`, `DecoratorMacro`, and `ImportMacro` constructor functions to make writing macros easier.

### `FunctionMacro`

Any expression can use this syntax: `macroName!!(expressions...)` to expand that expression. Some examples of things that are possible:

```ts
let a: undefined | number = 1
const v = required!!(a)

// could expand to:
let a: undefined | number = 1
if (a === undefined) throw new Error()
const v = a


function safeAdd(a: Result<number, string>, b: number) {
  return Ok(tr!!(a) + b)
}

// could expand to:
function safeAdd(a: Result<number, string>, b: number) {
  if (a.is_err()) return a
  return Ok(a.value + b)
}
```

Type signature:

```ts
import ts = require('typescript')
export type FunctionMacro = (
  args: ts.NodeArray<ts.Expression>,
  typeArgs: ts.NodeArray<ts.TypeNode> | undefined,
) => {
  prepend?: ts.Statement[],
  expression: ts.Expression,
  append?: ts.Statement[],
};
```

Example: TODO


### `BlockMacro`

Within a block of statements, you can use the `macroName!!;{ statements... }` syntax to expand those statements. Some examples of things that are possible:

```ts
parseable!!;{
  type A = {}
}
```

Type signature:

```ts
export type BlockMacro = (
  args: ts.NodeArray<ts.Statement>,
) => ts.Statement[];
```

Example: TODO


### `DecoratorMacro`

```ts
@validate!!()
type A = {
  a: number, b: string,
}

// could expand to:
type A = {
  a: number, b: string,
}
namespace A {
  export function validate(obj: unknown): Result<A, string> {
    /* ... */
  }
}



@get!!('/user/{id}')
async function user(id: number) {
  /* ... */
}

// could expand to:
async function user(id: unknown) {
  const idResult = validators.number.decode(id)
  if (idResult.is_err()) return response(400)
  /* ... */
}
api.get('/user/{id}', user)
```

Type signature:

```ts
export type DecoratorMacro = (
  statement: ts.Statement,
  args: ts.NodeArray<ts.Expression>,
  typeArgs: ts.NodeArray<ts.TypeNode> | undefined,
) => {
  original?: ts.Statement,
  additional?: ts.Statement[],
};
```

Example: TODO


### `import`

An import statement can use this form `import * as t from macroName!!('./some/path')` to create "virtual" typescript files at the path. Import macros are a lot like webpack/rollup loaders, except that the typescript file produced is typechecked and compiled just like any other.

This system is generic over some type (`S`) for additional sources to be produced and processed along with the typescript, so it's possible to use import macros as the basis of a robust and typesafe bundling system.

Let's imagine you had this yaml file describing some data:

```yaml
# obj.yaml
a: 'a'
b: 1
```

You could create a `yaml` macro to load it at compile time, perhaps expanding it to this "virtual" typescript:

```ts
// "virtual" obj.yaml.ts
export default {
  a: 'a',
  b: 1,
}
```

And then you can consume it in a typesafe way:

```ts
// main.ts
import obj from yaml!!('./obj.yaml')
obj.a.toLowerCase()
obj.b.toFixed()
obj.c // compiler error!
```

The possibilities are endless.


Type signature:

```ts
export type ImportMacro<S> = (
  ctx: FileContext,
  targetPath: string,
  targetSource: string,
) => {
  statements: ts.Statement[],
  sources?: Dict<S>,
};

export type FileContext = {
  workingDir: string,
  currentDir: string, currentFile: string
};
```

Example: TODO


## Project goals:

Overall, we want the macros to have these properties:

- Typechecked. Both the macro functions themselves and their outputs should be checked to prevent obvious errors. Also, we'd like to be able to compile a library with the available types narrowed to only those that will be available in the intended execution environment.
- Powerful. The syntax and capabilities of macros should allow very expressive and useful transformations.
- Explicit. It should be obvious that something is different about a macro invocation compared to its surroundings.

### Project non-goals:

Anything that requires first-class support from the actual typescript compiler basically won't be considered. If the compiler devs decide to make our lives easier, we'll gladly accept it. But we aren't going to wait around for them.

- Hygienic Macros. This would be very complicated to get right without first-class support from the compiler.
- Having a less ugly syntax. The `macroName!!` syntax is very ugly, but it's a hack that has some important properties. Suggestions for other syntaxes that meet these same requirements are welcome!
  - `!!` is accepted as valid syntax by the typescript parser.
  - `identifier!!` is *technically* valid (asserting the identifier is non-nullish *twice*) but never actually useful. This makes it distinct from normal uses of the non-nullish assertion.
- Alignment with typescript/javascript. As far as I'm concerned, javascript is just a compile target (and a lousy one), and typescript is the only just barely acceptable way to write web applications. Once webassembly has direct access to the browser api and is well-supported enough, I likely won't write a line of typescript ever again.


## Known Limitations

### Source maps

Since macros arbitrarily transform the original source, and then typecheck the *transformed* source, the `line:column` values in the typechecking errors won't necessarily correspond with the original source.

If you heavily rely on your editor to interact with typescript, you might have a bad time, since integrating your editor language service with `macro-ts` is unlikely to happen.
However if you instead mostly use the terminal, this problem is just an inconvenience.

**Pull requests are welcome!**

I don't know much about sourcemaps, and nice sourcemaps are less important to me than expressive and safe code, so I haven't prioritized this work. But I won't turn down reasonable pull requests to solve this problem.


## Roadmap

[ ] - Improve performance through caching, both of file data and build outputs.
