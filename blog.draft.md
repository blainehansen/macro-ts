static languages **need** powerful meta-programming
mapped and conditional types are the closest thing typescript already has, and they're definitely powerful, but they can only manipulate the program on a *type* level, which basically just empowers the existing dynamic nature of javascript with (leaky) type safety
true meta programming can produce actual code. When trying to write truly typesafe code, there ends up being a bunch of convenience glue to do tasks that are just a mirror of types, but that can't be done on a purely type level. Typescript is insanely incomplete without this.

I have a few things I'm excited about using this project for:

- We don't have to compromise so often between performance and readability. Macros can be written that wrap the most efficient version of a pattern in an abstraction that looks like a less efficient one. Since javascript is interpreted that code couldn't ever have both from some optimizing compiler, and we have to just rely on whatever browser engine to be really clever.
- This could dramatically change how we think about "loaders", and allow a lot more flexibility along with type safety without having to roll so much custom architecture. The implications of this flexibility are vast. Example of typesafe sql or other dsl's.
- Sometimes the more typesafe pattern is a more verbose one. Example of "question mark" operator.
- We can have an admittedly gross and imperfect version of derivable traits, if you squint hard. Example of validatable types.

some thoughts on the design decisions of the project.

super caveats about status of project, how rough it is (performance, code cleanliness, general source map/debugging issues), more looking for feedback. help is welcome.
