# `macro-ts`

This project aims to fill the missing meta-programming gap in typescript.

Anyone who's used a statically typed language with a powerful and safe macro/meta-programming system knows that they are essential to truly unlock the full power of the language. Static types without meta-programming are simply too inflexible to be used for common purposes.

You may be saying: but [typescript already has macros!]() However, it's very important to notice that the transformation process allowed by the typescript compiler **don't typecheck the transformed output**. This makes them unsafe and not very useful.

`macro-ts` attempts to solve that.

## Project Goals:

Overall, we want the macros to have these properties:

- Typechecked. Both the macro functions themselves and their outputs.
- Flexible and powerful.
- Explicit. It should be obvious that something is different about a macro invocation compared to its surroundings.

### Project Non-goals:

Essentially anything that requires first-class support from the actual typescript compiler basically won't be considered. If the compiler devs decide to make our lives easier, we'll gladly accept it. But we aren't going to wait around for them.

- Hygienic Macros. This would be very complicated to get right without first-class support from the compiler.
- Having a less ugly syntax. The general `macroName!!` syntax is very ugly, but it's a hack that has some important properties. Suggestions for other syntaxes that meet this same requirements are welcome!
  - `!!` is accepted as valid syntax by the typescript parser.
  - `identifier!!` is *technically* valid (asserting the identifier is non-nullish *twice*) but never actually useful. This makes it distinct from normal uses of the non-nullish assertion.
- Alignment with typescript/javascript. As far as I'm concerned, javascript is just a compile target (and a lousy one), and typescript is the only just barely acceptable way to write web applications. Once webassembly has direct access to browser apis and is well-supported enough, I likely won't write a line of typescript ever again.


## cli useage

The `macro-ts` cli has these subcommands:


### `run entryFile.ts`

### `check entryFile.ts` or `check dir --exclude='node_modules' --exclude='*.test.ts'`

### `build entryFile.ts` or `build dir --exclude='node_modules' --exclude='*.test.ts'`


There are four kinds of macros:

## `function`

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

## `block`

Within a block of statements, you can use the `macroName!!;{ statements... }` syntax to expand those statements. Some examples of things that are possible:

```ts
parseable!!;{
  type A = {}
}
```

## `decorator`

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

## `import`

An import statement can use this form to `import * as t from macroName!!('./some/path')` to create "virtual" typescript files at the path. Import macros are a lot like webpack/rollup loaders, except that the typescript file produced is typechecked and compiled just like any other.

This system allows for generic other types of resources to be created along with the typescript, so it's possible to use import macros as the basis of an *actual* bundling system.



## Known Limitations

### Source Mapping

Since macros arbitrarily transform the original source, and then typecheck the *transformed* source, this presents source mapping problems. Specifically, at this point the `line:column` pointers in your typechecking errors won't necessarily correspond with your original source.

If you heavily rely on your editor to interact with typescript, you might have a bad time, since integrating your editor language service with `macro-ts` is unlikely to happen.
However if you instead mostly use the terminal, this problem won't really get in your way much.

**However, pull requests are welcome!**

I don't know much about sourcemaps at this point, and nice sourcemaps are less important to me than expressive and safe code, so I haven't prioritized this work, but I won't turn down reasonable pull requests bringing it in.
