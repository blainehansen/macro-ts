import ts = require('typescript')

// this project it seems has multiple compiler types
// - a macro capable typescript compiler. so import style macros should return statements to inline into the importing file.
// - a web app "bundler". the target files are html, with attached processed resources and static resources
// - a web library "bundler". this one's tricky. people very well might want to include css or whatever. so it seems in this situation, we just produce files, and their macros determine entirely what kinds of transformations have happened to them
// - a web component bundler. eh


type ImportContext = {
	projectEntryPath: string,
	currentFileRelativePath: string,
	currentFileBasename: string,
}

type Macro =
	| {
		// called in the form: macro!!()
		type: 'function',
		functionMacro: (args: ts.NodeArray<ts.Expression>) => ts.Expression,
	}
	| {
		// called in the form: macro!!{}
		type: 'block',
		blockMacro: (args: ts.NodeArray<ts.Statement>) => ts.NodeArray<ts.Statement>,
	}
	| {
		// called in the form: import whatever from macro!!('path')
		type: 'import',
		// StringLiteral can have globs
		importMacro: (path: string, args: ts.NodeArray<ts.Expression>, /* TODO probably also need import pattern */ context: ImportContext) => {
			// to be inlined into the calling typescript file
			statements?: ts.NodeArray<ts.Statement>,
			// these further files will be processed as if an importMacro with the name extension had been applied to them directly
			furtherFiles?: { extension: string, source: string }[],
			// a "file" of typescript that this import produces
			ts?: ts.NodeArray<ts.Statement>,
			resources?: Resource[],
		},
	}

type Resource =
	| {
		// sourcemaps?
		type: 'script' | 'css',
		mode: 'normal' | 'preload' | 'prefetch' | 'inline',
		location: 'head' | 'body',
		text: string,
	}
	| { type: 'static', path: string, extension: string, content: Buffer }


// really at the end of the day, all we *really* have aren't "bundles" and all this, but just:
// - the app, which consists of arbitrary linkable files that are fetched by....
// - html files, which have html contents, arbitrary items in the head, and we can nicely define all the immediate dependencies, the preloads, and the prefetches


type AppCompiler<A extends unknown[]> = (...args: A) => {
	htmlFiles: HtmlFile[],
	staticResources: StaticResource[],
	processedResources: ProcessedResource[],
}

type HtmlFile = {
	// https://github.com/fb55/htmlparser2 ?
	body: HtmlNode[],
}

type MacroTypescriptCompiler = (entryPath: string, macros: Dict<Macro>) => void?
