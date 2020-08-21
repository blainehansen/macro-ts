# `macro-ts`

An ergonomic typescript compiler that enables typesafe syntactic macros.

Write code like this:

```ts
// an import macro
import ProductDetails from sql!!('./productDetails.sql')

// a block macro
db!!;{
  port = 5432; host = 'db'
  user = DB_ENV_USER
  password = DB_ENV_PASS,
}

// a decorator macro
@get!!('/product/{id}')
async function productDetails(id: number) {
  const queryResult = await db.query(ProductDetails.compile(id))
  // a function macro
  const products = required!!(queryResult)
  const count = products.length
  return { products, count }
}
```

and have it transformed into something like the following, *and then fully typechecked*:

```ts
// import macros can inspect the contents of real files
// and produce "virtual" typescript files
import ProductDetails from './productDetails.sql.ts'

// block macros can inspect a list of statements
// and expand to any other list of statements
import driver from 'some-database-driver-library'
const dbUser = process.env.DB_ENV_USER
if (!dbUser) throw new Error(`DB_ENV_USER isn't set`)
const dbPassword = process.env.DB_ENV_PASS
if (!dbPassword) throw new Error(`DB_ENV_PASS isn't set`)
const db = new driver.Pool({
  port: 5432, host: 'db',
  user: dbUser, password: dbPassword,
})

// a decorator macro can inspect the statement it's attached to
// choose to replace that statement
// and provide additional statements to place around it
import * as v from 'some-validation-library'
const productDetailsParamsValidator = v.object({ id: v.number })
async function productDetails(params: { [key: string]: unknown }) {
  const paramsResult = productDetailsParamsValidator.validate(params)
  if (paramsResult === null)
    throw new v.ValidationError(params)
  const { id } = paramsResult

  const queryResult = await db.query(ProductDetails.compile(id))
  // function macros can inspect the args it's passed
  // return any expression to replace the function call
  // and provide additional statements to place around it
  if (queryResult === null)
    throw new Error()
  const products = queryResult.value
  const count = products.length
  return { products, count }
}
app.get('/product/{id}', productDetails)
```

Typesafe macros can unlock huge productivity gains for any development team. Enjoy!


## Quickstart

You can quickly run or check code without a project configuration file. This method is appropriate for rapid prototyping or experimentation, will use the `anywhere` compilation environment, and will optionally attempt to to load macros from a `.macros.ts` file in the current working directory.

```bash
npx macro-ts run someScript.ts
npx macro-ts check 'someDir/**/*.ts'
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
# you can give a package
# more than one compilation environment
environment = ['modernbrowser', 'legacybrowser']

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

In the javascript world, we almost always write code with one of these intended execution environments, which effects what ambient type libraries typescript should include:

- `browser`: requires the dom libraries and globals.
- `webworker`: requires the webworker libraries and globals.
- `node`: requires the node libraries and globals.
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

## Dev mode

By default these settings are used when typechecking: `noUnusedParameters: true`, `noUnusedLocals: true`, `preserveConstEnums: false`, and `removeComments: true`.

These settings are all more appropriate for a release quality build. Both the config file and the cli however support a "dev" mode that inverts all these settings to their more lenient form.


## Config format

The `.macro-ts.toml` file will accept configs matching this type:

```ts
export type MacroTsConfig = {
  macros?: string,
  packages: {
    location: string,
    entry: string | [string, ...string[]],
    exclude?: string | [string, ...string[]],
    environment: ConfigEnv | [ConfigEnv, ...ConfigEnv[]],
    dev?: boolean,
  }[]
}

type ConfigEnv =
  | CompilationEnvironment
  | 'legacybrowser' | 'modernbrowser'
  | 'webworker'
  | 'node'
  | 'anywhere'

export type CompilationEnvironment = {
  platform: 'browser' | 'webworker' | 'node' | 'anywhere',
  target: ScriptTarget,
}

export type ScriptTarget = Exclude<ts.ScriptTarget, ts.ScriptTarget.JSON>;
```


## Cli usage

The cli has these global options:

- `--help` (alias `-h`). Displays help message.
- `--version` (alias `-v`). Displays the version.
- `--dev` (alias `-d`). Performs typechecking in "dev" mode.

The cli has these subcommands:

### `run <entryFile>.ts`

Runs the given file.

Since this inherently means the code will be run in node, node appropriate typechecking settings are used, regardless of any package specific settings that could apply to the code. Rely on the `check` and `build` commands to correctly typecheck for intended release environments.

```bash
macro-ts run main.ts
macro-ts --dev run playground.ts
```

### `check [entryGlob]`

Only typechecks the code, without running it or emitting any javascript.

The `entryGlob` is optional if a `.macro-ts.toml` file is present, and if not provided will check all packages in that config file.

```bash
macro-ts check
macro-ts --dev check
macro-ts check 'dir/working/on/**/*.ts'
macro-ts --dev check 'other/dir/*.ts'
```

### `build`

Builds all configured packages, emitting them into `target/.dist`.

Requires a `.macro-ts.toml` file.

Since each package could be emitted with different settings based on the intended execution environment, any common modules will be compiled multiple times in different forms in different `.dist` directories.

```bash
macro-ts build
macro-ts --dev build
```

## Writing macros

Here's a simple macros file:

```ts
import {
  FunctionMacro, BlockMacro,
  DecoratorMacro, ImportMacro,
} from 'macro-ts'

export const macros = {
  f: FunctionMacro(/* ... */),
  b: BlockMacro(/* ... */),
  d: DecoratorMacro(/* ... */),
  i: ImportMacro(/* ... */),
}
```

All macros are given a `MacroContext` object that contains helper functions for returning values from macros. These helpers basically all deal with `SpanResult<T>`, a type that signifies either that the macro was successful and is returning a value (using `Ok`), or that it failed and is returning some errors to show to the user (using `TsNodeErr` or `Err`). `TsNodeErr` is especially useful, since it allows you to give any typescript `Node` that will be highlighted as the source of the error, along with text describing it.

`tsNodeWarn` and `warn` are also provided to allow you to give warnings to the user that don't necessarily require failure.

```ts
import ts = require('typescript')
export type MacroContext = {
  Ok: <T>(value: T) => SpanResult<T>,
  TsNodeErr: (node: ts.TextRange, title: string, ...paragraphs: string[]) => SpanResult<any>,
  Err: (fileName: string, title: string, ...paragraphs: string[]) => SpanResult<any>,
  tsNodeWarn: (node: ts.TextRange, title: string, ...paragraphs: string[]) => void,
  warn: (fileName: string, title: string, ...paragraphs: string[]) => void,
};
```

The `macro-ts` cli expects the macros file to export a dictionary named `macros`. The `macro-ts` library provides the `FunctionMacro`, `BlockMacro`, `DecoratorMacro`, and `ImportMacro` constructor functions to make writing macros easier.

### `FunctionMacro`

Any expression can use this syntax: `macroName!!(expressions...)` to expand that expression.

```ts
// this code:
let a: undefined | number = 1
const v = required!!(a)

// could expand to:
let a: undefined | number = 1
if (a === undefined) throw new Error()
const v = a
```

Example:

```ts
import ts = require('typescript')
import { FunctionMacro } from './lib/transformer'

export const macros = {
  required: FunctionMacro((ctx, args) => {
    if (args.length !== 1) return ctx.TsNodeErr(
      args, 'Incorrect arguments',
      'The "required" macro accepts exactly one argument.',
    )

    const target = args[0]
    return ctx.Ok({
      prepend: [ts.createIf(
        ts.createBinary(
          target,
          ts.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
          ts.createIdentifier('undefined'),
        ),
        ts.createThrow(
          ts.createNew(ts.createIdentifier('Error'), undefined, []),
        ),
        undefined,
      )],
      expression: target,
      append: [],
    })
  }),
}
```

Type signature:

```ts
import ts = require('typescript')
export type FunctionMacro = (
  ctx: MacroContext,
  args: ts.NodeArray<ts.Expression>,
  typeArgs: ts.NodeArray<ts.TypeNode> | undefined,
) => SpanResult<{
  prepend?: ts.Statement[],
  expression: ts.Expression,
  append?: ts.Statement[],
}>;
```


### `BlockMacro`

Within a block of statements, you can use the `macroName!!;{ statements... }` syntax to expand those statements. Some examples of things that are possible:

```ts
// this code:
repeat!!;{
  times = 3
  greetings += yo().dude()
}

// could expand to:
greetings += yo().dude()
greetings += yo().dude()
greetings += yo().dude()
```

Example:

```ts
import ts = require('typescript')
import { BlockMacro } from './lib/transformer'

export const macros = {
  repeat: BlockMacro((ctx, inputStatements) => {
    const [times, statement] = inputStatements
    if (
      !times || !statement
      || !ts.isExpressionStatement(times)
      || !ts.isBinaryExpression(times.expression)
      || !ts.isIdentifier(times.expression.left)
      || times.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken
      || !ts.isNumericLiteral(times.expression.right)
    ) return ctx.TsNodeErr(
      inputStatements, 'Invalid repeat',
      `The "repeat" macro isn't being used correctly.`,
    )

    const repetitions = parseInt(times.expression.right.text)
    const statements = [...Array(repetitions)].map(() => statement)
    return ctx.Ok(statements)
  }),
}
```

Type signature:

```ts
import ts = require('typescript')
export type BlockMacro = (
  ctx: MacroContext,
  args: ts.NodeArray<ts.Statement>,
) => SpanResult<ts.Statement[]>;
```

### `DecoratorMacro`

Decorator macros can be used on definitions, such as type aliases, interfaces, classes, functions, and variable declarations.

```ts
// this code:
@creator!!()
type A = {
  a: number, b: string,
}

// could expand to:
type A = {
  a: number, b: string,
}
function A(a: number, b: string): A {
  return { a, b }
}
```

Example:

```ts
import ts = require('typescript')
import { DecoratorMacro } from './lib/transformer'

export const macros = {
  creator: DecoratorMacro((ctx, statement) => {
    if (
      !ts.isTypeAliasDeclaration(statement)
      || !ts.isTypeLiteralNode(statement.type)
    ) return ctx.TsNodeErr(
      statement, 'Not a type literal',
      `The "creator" macro isn't being used correctly.`,
    )

    const members: { name: ts.Identifier, type: ts.TypeNode }[] = []
    for (const member of statement.type.members) {
      if (
        !ts.isPropertySignature(member)
        || !member.type
        || !ts.isIdentifier(member.name)
      ) return ctx.TsNodeErr(
        member, 'Invalid member',
        `The "creator" macro requires all members to be simple.`,
      )

      members.push({ name: member.name, type: member.type })
    }

    const parameters = members.map(({ name, type }) => {
      return ts.createParameter(
        undefined, undefined, undefined, name,
        undefined, type, undefined,
      )
    })
    const properties = members.map(({ name }) => {
      return ts.createShorthandPropertyAssignment(name, undefined)
    })

    const creator = ts.createFunctionDeclaration(
      undefined, undefined, undefined,
      statement.name,
      statement.typeParameters, parameters,
      ts.createTypeReferenceNode(statement.name, undefined),
      ts.createBlock([
        ts.createReturn(
          ts.createObjectLiteral(properties, false),
        ),
      ], true),
    )

    return ctx.Ok({ replacement: statement, additional: [creator] })
  }),
}
```

Type signature:

```ts
import ts = require('typescript')
export type DecoratorMacro = (
  ctx: MacroContext,
  statement: ts.Statement,
  args: ts.NodeArray<ts.Expression>,
  typeArgs: ts.NodeArray<ts.TypeNode> | undefined,
) => SpanResult<{
  prepend?: ts.Statement[],
  replacement: ts.Statement | undefined,
  append?: ts.Statement[],
}>;
```

### `ImportMacro`

An import statement can use this form `import * as t from macroName!!('./some/path')` to create "virtual" typescript files at the path. Import macros are a lot like webpack/rollup loaders, except that the typescript file produced is typechecked and compiled just like any other.

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

Example:

```ts
import yaml = require('js-yaml')
import ts = require('typescript')
import { ImportMacro } from './lib/transformer'

export const macros = {
  yaml: ImportMacro((ctx, targetSource, targetPath) => {
    const obj = YAML.safeLoad(targetSource)
    if (typeof obj !== 'object')
      return ctx.Err(
        targetPath, 'Invalid yaml',
        `The "yaml" macro requires the yaml contents to be an object.`,
      )

    const properties = Object.entries(obj).map(([key, value]) => {
      return ts.createPropertyAssignment(
        ts.createIdentifier(key),
        // this is a cool hack,
        // typescript just passes "identifiers" along exactly!
        ts.createIdentifier(JSON.stringify(value)),
      )
    })
    const statement = ts.createExportAssignment(
      undefined, undefined,
      undefined, ts.createObjectLiteral(properties, false),
    )

    return ctx.Ok({ statements: [statement] })
  }),
}
```

Type signature:

<!-- TODO document this properly. This system is generic over some type (`S`) for additional sources to be produced and processed along with the typescript, so it's possible to use import macros as the basis of a robust and typesafe bundling system. -->

```ts
import ts = require('typescript')
export type ImportMacro<S = undefined> = (
  ctx: MacroContext,
  targetSource: string,
  targetPath: string,
  file: FileContext,
) => SpanResult<{
  statements: ts.Statement[],
  // don't worry about this,
  // it's just here for future improvements
  sources?: Dict<S>,
}>

export type FileContext = {
  workingDir: string,
  currentDir: string, currentFile: string
}
export type Dict<T> = { [key: string]: T };
```


## Hint: use `ts-creator`

The simple but wonderful [`ts-creator` package](https://www.npmjs.com/package/ts-creator) makes it much easier to figure out how to generate typescript of a certain shape, so you can worry about making interesting macros rather than the minutiae of the typescript AST.

I especially recommend the [cli](https://www.npmjs.com/package/ts-creator#cli-usage).


## Project goals:

Overall, we want the macros to have these properties:

- Typesafe. Both the macro functions themselves and their outputs should be checked to prevent obvious errors. Also, we'd like to be able to compile a library with the ambient types narrowed to only those that will be available in the intended execution environment.
- Powerful. The syntax and capabilities of macros should allow very expressive and useful transformations.
- Explicit. It should be obvious that something is different about a macro invocation compared to its surroundings.

### Project non-goals:

Anything that requires first-class support from the actual typescript compiler basically won't be considered. If the typescript team decides to make life easier, I'll gladly accept it. But I'm not going to wait around for them.

- Hygienic Macros. This would be very complicated to get right without first-class support from the compiler.
- Having a less ugly syntax. The `macroName!!` syntax is very ugly, but it's a hack that has some important properties. Suggestions for other syntaxes that meet these same requirements are welcome!
  - `!!` is accepted as valid syntax by the typescript parser.
  - `!!` is visually obvious. A reader can tell that this usage is different than the surrounding code.
  - `identifier!!` is *technically* valid (asserting the identifier is non-nullish *twice*) but never actually useful. This makes it distinct from normal uses of the non-nullish assertion, and doesn't conflict with any useful pattern.
- Alignment with javascript/typescript. As far as I'm concerned, javascript is just a compile target (and a lousy one). I'm much more worried about expressive and safe code, and don't really care what microsoft corporation or the TC39 group would prefer.

## Project philosophy

[This blog post describes my motivations for this project.](https://blainehansen.me/post/macro-ts/)

## Known Limitations

### Source maps

Since macros arbitrarily transform the original source, and then typecheck the *transformed* source, the `line:column` values in the typechecking errors won't necessarily correspond with the original source.

If you heavily rely on your editor to interact with typescript, you might have a bad time, since integrating your editor language service with `macro-ts` is unlikely to happen.
However if you instead mostly use the terminal, this problem is just an inconvenience.

**Pull requests are welcome!**

I don't know much about sourcemaps, and nice sourcemaps are less important to me than expressive and safe code, so I haven't prioritized this work. But I won't turn down reasonable pull requests to solve this problem.


## Roadmap

- [ ] Improve performance through caching, both of file data and build outputs.
- [ ] Generalize compilation functions to allow using `macro-ts` to be used as the foundation of arbitrary specialized typesafe compilers, like a web application bundler.
