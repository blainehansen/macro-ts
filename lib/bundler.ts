// import ts = require('typescript')

// // this project it seems has multiple compiler types
// // - a macro capable typescript compiler. so import style macros should return statements to inline into the importing file.
// // - a web app "bundler". the target files are html, with attached processed resources and static resources
// // - a web library "bundler". this one's tricky. people very well might want to include css or whatever. so it seems in this situation, we just produce files, and their macros determine entirely what kinds of transformations have happened to them
// // - a web component bundler. eh

// type Resource =
// 	| {
// 		// sourcemaps?
// 		type: 'script' | 'style',
// 		mode: 'normal' | 'preload' | 'prefetch' | 'inline',
// 		location: 'head' | 'body',
// 		text: string,
// 	}
// 	| { type: 'static', path: string, extension: string, content: Buffer }


// // really at the end of the day, all we *really* have aren't "bundles" and all this, but just:
// // - the app, which consists of arbitrary linkable files that are fetched by....
// // - html files, which have html contents, arbitrary items in the head, and we can nicely define all the immediate dependencies, the preloads, and the prefetches


// type AppCompiler<A extends unknown[]> = (...args: A) => {
// 	htmlFiles: HtmlFile[],
// 	staticResources: StaticResource[],
// 	processedResources: ProcessedResource[],
// }

// type HtmlFile = {
// 	// https://github.com/fb55/htmlparser2 ?
// 	body: HtmlNode[],
// }

// // just to get it off my mind, we'll use rollup to do the actual tree shaking and its plugin ecosystem, minification etc
// // https://rollupjs.org/guide/en/#javascript-api
