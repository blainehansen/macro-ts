# `macro-ts`

An ergonomic compiler for typescript that allows typesafe and extremely powerful syntactic macros.

Write code like this:

```ts
import ProductDetails from sql!!('./productDetails.sql')

db!!;{
  config = { port: 5432, host: 'db', user: 'sterling', password: 'guest' }
}

@get!!('/product/{id}')
async function productDetails(id: number) {
  const queryResult = await db.query(ProductDetails.compile(id))
  const products = required!!(queryResult)
  const count = products.length
  return { products, count }
}
```

and have it transformed into something like the following, *and then fully typechecked*:

```ts
// import macros can produce "virtual" typescript files
// by inspecting the contents of real files
import ProductDetails from './productDetails.sql.ts'

// block macros can inspect a list of statements
// and expand to any other list of statements
namespace db {
  import { Pool } from 'pg'
  const pool = new Pool({ port: 5432, host: 'db', user: 'sterling', password: 'guest' })
  type QueryObject<T> = {
    text: string,
    values?: unknown[],
    type: T | undefined, // a potential type inference hack
  }
  export async function query<T>(query: QueryObject<T>): T | null {
    const client = await pool.connect()
    const queryResult = await client.query(query.text, query.values)
    client.release()
    return queryResult
  }
}

// a decorator macro can inspect whatever it's attached to
// and expand to any list of typescript statements
import * as v from 'some-validation-library'
const productDetailsParamsValidator = v.object({ id: v.number })
async function productDetails(params: { [key: string]: string }) {
  const paramsResult = productDetailsParamsValidator.validate(params)
  if (paramsResult === null)
    throw new v.ValidationError(params)
  const { id } = paramsResult

  const queryResult = await db.query(ProductDetails.compile(id))
  // function macros can inspect the expression they're given
  // and return any expression to replace it
  // as well as provide additional statements to insert around the expression
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

You can quickly run or check code without a project configuration file. This method is appropriate for rapid prototyping or experimentation, will use the `anywhere` compilation environment, and will try to load macros from a `.macros.ts` file in the current working directory.

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
}
```

- `legacybrowser`: `{ platform: 'browser', target: ts.ScriptTarget.ES5 }`
- `modernbrowser`: `{ platform: 'browser', target: ts.ScriptTarget.Latest }`
- `webworker`: `{ platform: 'webworker', target: ts.ScriptTarget.Latest }`
- `node`: `{ platform: 'node', target: ts.ScriptTarget.Latest }`
- `anywhere`: `{ platform: 'anywhere', target: ts.ScriptTarget.Latest }`

## Dev mode

By default these settings are used when typchecking: `noUnusedParameters: true`, `noUnusedLocals: true`, `preserveConstEnums: false`, and `removeComments: true`.

These settings are all more appropriate for a release quality build. Both the config file and the cli however support a "dev" mode that inverts all these settings to their more lenient form.


## Config format

The `.macro-ts.toml` file will accept configs matching this type:

```ts
export type MacroTsConfig = {
  macros?: string,
  packages: {
    location: string,
    entry: string | [string, ...string],
    exclude?: string | [string, ...string],
    environment:
      | CompilationEnvironment
      | 'legacybrowser' | 'modernbrowser'
      | 'webworker'
      | 'node'
      | 'anywhere'
    dev?: boolean,
  }[]
}

export type CompilationEnvironment = {
  platform: 'browser' | 'webworker' | 'node' | 'anywhere',
  target: ScriptTarget,
}

export type ScriptTarget = Exclude<ts.ScriptTarget, ts.ScriptTarget.JSON>
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
  required: FunctionMacro(args => {
    if (args.length !== 1) throw new Error("some helpful message")
    const target = args[0]
    return {
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
    }
  }),
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
}
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
  repeat: BlockMacro(args => {
    const [times, statement] = args
    if (
      !times || !statement
      || !ts.isExpressionStatement(times)
      || !ts.isBinaryExpression(times.expression)
      || !ts.isIdentifier(times.expression.left)
      || !ts.isIdentifier(times.expression.left)
      || times.expression.operatorToken !== ts.SyntaxKind.EqualsToken
      || !ts.isNumericLiteral(times.expression.right)
    ) throw new Error("some helpful message")

    const repetitions = parseInt(times.expression.right.text)
    const statements = [...Array(repetitions)].map(() => statement)
    return statements
  }),
}
```

Type signature:

```ts
export type BlockMacro = (
  args: ts.NodeArray<ts.Statement>,
) => ts.Statement[]
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
  creator: DecoratorMacro(statement => {
    if (
      !ts.isTypeAliasDeclaration(statement)
      || !ts.isTypeLiteralNode(statement)
    ) throw new Error("some helpful message")

    const members = statement.members.map(member => {
      if (
        !ts.isPropertySignature(member)
        || !member.type
        || !ts.isIdentifier(member.name)
      ) throw new Error("some helpful message")

      return { name: member.name, type: member.type }
    })

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

    return { original: statement, additional: [creator] }
  }),
}
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
}
```

### `ImportMacro`

An import statement can use this form `import * as t from macroName!!('./some/path')` to create "virtual" typescript files at the path. Import macros are a lot like webpack/rollup loaders, except that the typescript file produced is typechecked and compiled just like any other.

<!-- TODO document this properly. This system is generic over some type (`S`) for additional sources to be produced and processed along with the typescript, so it's possible to use import macros as the basis of a robust and typesafe bundling system. -->

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
  yaml: ImportMacro((_ctx, _targetPath, targetSource) => {
    const obj = yaml.safeLoad(targetSource)
    if (typeof obj !== 'object')
      throw new Error("some helpful message")

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

    return { statements: [statement] }
  }),
}
```

Type signature:

```ts
export type ImportMacro = (
  ctx: FileContext,
  targetPath: string,
  targetSource: string,
) => {
  statements: ts.Statement[],
}

export type FileContext = {
  workingDir: string,
  currentDir: string, currentFile: string
}
export type Dict<T> = { [key: string]: T }
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

Anything that requires first-class support from the actual typescript compiler basically won't be considered. If the compiler devs decide to make our lives easier, I'll gladly accept it. But I'm not going to wait around for them.

- Hygienic Macros. This would be very complicated to get right without first-class support from the compiler.
- Having a less ugly syntax. The `macroName!!` syntax is very ugly, but it's a hack that has some important properties. Suggestions for other syntaxes that meet these same requirements are welcome!
  - `!!` is accepted as valid syntax by the typescript parser.
  - `identifier!!` is *technically* valid (asserting the identifier is non-nullish *twice*) but never actually useful. This makes it distinct from normal uses of the non-nullish assertion.
- Alignment with javascript/typescript. As far as I'm concerned, javascript is just a compile target (and a lousy one). I'm not at all concerned with aligning with the language's norms.

## Project philosophy

This project aims to fill the missing meta-programming gap in typescript.

Anyone who's used a statically typed language with a powerful and safe macro/meta-programming system knows that they are essential to truly unlock the full power of the language. Statically typed languages without meta-programming are simply too inflexible to be truly productive, and statically typed languages *with* meta-programming are unbelievably safe and productive.

You may be saying: but [typescript already has macros!](https://blog.logrocket.com/using-typescript-transforms-to-enrich-runtime-code-3fd2863221ed/) However, it's very important to notice that the transformation process allowed by the typescript compiler **don't typecheck the transformed output**. This makes them unsafe and not very useful.

[Mapped](https://www.typescriptlang.org/docs/handbook/advanced-types.html#mapped-types) and [Conditional](https://www.typescriptlang.org/docs/handbook/advanced-types.html#conditional-types) types can do some of the work that traditional macros would usually do, but they aren't nearly complete.

`macro-ts` attempts to solve that, at least in the short term. This project also adds some nice conveniences to using the compiler, and compiling for multiple simply defined targets.


## Known Limitations

### Source maps

Since macros arbitrarily transform the original source, and then typecheck the *transformed* source, the `line:column` values in the typechecking errors won't necessarily correspond with the original source.

If you heavily rely on your editor to interact with typescript, you might have a bad time, since integrating your editor language service with `macro-ts` is unlikely to happen.
However if you instead mostly use the terminal, this problem is just an inconvenience.

**Pull requests are welcome!**

I don't know much about sourcemaps, and nice sourcemaps are less important to me than expressive and safe code, so I haven't prioritized this work. But I won't turn down reasonable pull requests to solve this problem.


## Roadmap

- [ ] - Improve performance through caching, both of file data and build outputs.
- [ ] - Provide nice "codeframe" error functionality to macro functions.
