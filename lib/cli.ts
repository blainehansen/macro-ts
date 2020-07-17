#!/usr/bin/env node

// it seems there a few subcommands
// - run: does the equivalent of ts-node
// - build: does the equivalent of tsc
// - check: does build but doesn't emit
// - test: ?
// - new: quickly scaffold a new project?

// it's possible for us to precompile all the macro files if they're declared somewhere....
// and then we can "generate" an entry file based on their config and type check it

// let's just override tsconfig! the possibility of using toml or yml is there
// also, we can do all the braindead obvious defaults, like strict: true

// it seems for all of these options, I first need to have a way to discover what macros are registered
// the option I'm liking is some config file that replaces tsconfig that gives all their locations
// with all those locations in hand, I can create a virtual entry file that contains the code to compile and execute *their* code
// then the first step is to compile that file (which should only change when their macros or config changes, so we can cache all the compiled results somewhere), then execute that file

// since we're replacing tsconfig, we can do all the smart things they didn't do, like validating that there aren't any extra fields, which prevents confusion if they misplace or misspell something
// and it can be in a half decent config language that allows comments!

// maybe someday if you're bored you can replace all the package.json stuff too, but let's not get crazy
