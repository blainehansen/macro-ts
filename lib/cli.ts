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
