import * as chalk from 'chalk'
import * as ts from 'typescript'
import { Result, Ok as MonadsOk, Err as MonadsErr } from '@ts-std/monads'

import { NonEmpty } from './utils'

export type SourceFile = Readonly<{
	source: string, filename?: string,
}>

export type Span = Readonly<{
	file: SourceFile, start: number, end: number,
	line: number, column: number,
}>
export function Span(file: SourceFile, start: number, text: string, line: number, column: number): Span {
	return { file, start, end: start + text.length, line, column }
}
export namespace Span {
	export function fromTsNode(sourceFile: ts.SourceFile, { pos: start, end }: ts.TextRange): Span {
		const { line: zeroLine, character: column } = sourceFile.getLineAndCharacterOfPosition(start)
		const { text: source, fileName: filename } = sourceFile
		return { file: { source, filename }, start, end, line: zeroLine + 1, column }
	}
}

export type SpanError = Readonly<{ region: Span | string, title: string, message: string, error: true }>
export function SpanError(region: Span | string, title: string, paragraphs: string[]) {
	return { region, title, message: paragraphs.join('\n'), error: true } as SpanError
}

export type SpanWarning = Readonly<{ region: Span | string, title: string, message: string, error: false }>
export function SpanWarning(region: Span | string, title: string, paragraphs: string[]): SpanWarning {
	return { region, title, message: paragraphs.join('\n'), error: false } as SpanWarning
}

export type SpanResult<T> = [Result<T, NonEmpty<SpanError>>, SpanWarning[]?]
export namespace SpanResult {
	// export function Ok<T>(value: T, warnings?: SpanWarning[]): SpanResult<T> {
	// 	return [MonadsOk(value), warnings]
	// }
	export function Ok<T>(value: T): SpanResult<T> {
		return [MonadsOk(value)]
	}
	export function TsNodeErr(sourceFile: ts.SourceFile, node: ts.TextRange, title: string, paragraphs: string[]): SpanResult<any> {
		return [MonadsErr([SpanError(Span.fromTsNode(sourceFile, node), title, paragraphs)])]
	}
	export function Err(fileName: string, title: string, paragraphs: string[]): SpanResult<any> {
		return [MonadsErr([SpanError(fileName, title, paragraphs)])]
	}

	export type UnSpan<R extends SpanResult<any>> = R extends SpanResult<infer T> ? Result<T, void> : never

	export function checkSuccess(errors: SpanError[], warnings: SpanWarning[]): [Result<void, NonEmpty<SpanError>>, SpanWarning[]] {
		return [errors.length ? MonadsErr(errors as NonEmpty<SpanError>) : MonadsOk(undefined as void), warnings]
	}

	export class Context {
		protected errors: SpanError[] = []
		protected warnings: SpanWarning[] = []
		drop() {
			const errors = this.errors.splice(0, this.errors.length)
			const warnings = this.warnings.splice(0, this.warnings.length)
			return { errors, warnings }
		}

		constructor(readonly sourceFile: ts.SourceFile) {}

		subsume<T>([result, warnings]: SpanResult<T>): Result<T, void> {
			if (warnings && warnings.length)
				this.warnings = this.warnings.concat(warnings)

			if (result.is_ok()) return MonadsOk(result.value)
			this.errors = this.errors.concat(result.error)
			return MonadsErr(undefined as void)
		}
		tsNodeWarn(node: ts.TextRange, title: string, paragraphs: string[]) {
			this.warnings.push(SpanWarning(Span.fromTsNode(this.sourceFile, node), title, paragraphs))
		}
		warn(fileName: string, title: string, paragraphs: string[]) {
			this.warnings.push(SpanWarning(fileName, title, paragraphs))
		}

		Err(node: ts.TextRange, title: string, ...paragraphs: string[]): Result<any, void> {
			this.errors.push(SpanError(Span.fromTsNode(this.sourceFile, node), title, paragraphs))
			return MonadsErr(undefined as void)
		}
	}
}


export function formatDiagnostics(errors: SpanError[], warnings: SpanWarning[], lineWidth: number) {
	return (errors as (SpanError | SpanWarning)[]).concat(warnings)
		.map(d => formatDiagnostic(d, lineWidth))
		.join('\n\n\n') + '\n'
}


const info = chalk.blue.bold
const file = chalk.magentaBright.bold

function clean(s: string) {
	return s.replace(/\t/g, '  ')
}

export function formatDiagnostic(
	{ region, title, message, error }: SpanError | SpanWarning,
	lineWidth: number,
): string {
	const header = info(`-- ${title} ` + '-'.repeat(lineWidth - (title.length + 4)))

	if (typeof region === 'string') {
		const fileHeader = '\n' + ' '.repeat(3) + file(region)
		return header + '\n' + fileHeader + formatMessage(message, '\n  ', lineWidth)
	}

	const { file: { source, filename }, start, end, line, column } = region
	const highlight = error ? chalk.red.bold : chalk.yellow.bold
	const lineNumberWidth = line.toString().length
	function makeGutter(lineNumber?: number, error = false) {
		const insert = lineNumber !== undefined
			? ' '.repeat(lineNumberWidth - lineNumber.toString().length) + info(lineNumber)
			: ' '.repeat(lineNumberWidth)
		return  `\n ${insert} ${info('|')}${error ? highlight('>') : ' ' } `
	}
	const blankGutter = makeGutter()
	const margin = `\n${' '.repeat(lineNumberWidth)}  `
	const messageLine = '\n' + formatMessage(message, margin, lineWidth)
	const fileHeader = (filename ? '\n' + ' '.repeat(lineNumberWidth + 3) + file(filename) : '')

	let sourceLineStart = start
	for (; sourceLineStart >= 0; sourceLineStart--)
		if (source[sourceLineStart] === '\n') break

	const lines: [number, string][] = []
	let currentLineNumber = line
	let currentLineStart = sourceLineStart
	while (currentLineStart < end) {
		let currentLineEnd = source.indexOf('\n', currentLineStart + 1)
		if (currentLineEnd < 0) break
		lines.push([currentLineNumber, source.slice(currentLineStart + 1, currentLineEnd)])
		currentLineStart = currentLineEnd
		currentLineNumber++
	}

	switch (lines.length) {
	case 0: throw new Error('zuh?')

	case 1:
		const [[, sourceLine]] = lines

		const printSourceLine = clean(sourceLine)
		const pointerPrefix = ' '.repeat(clean(sourceLine.slice(0, column)).length)
		const pointerWidth = end - start
		const pointer = pointerPrefix + highlight('^'.repeat(pointerWidth))

		return header
			+ '\n' + fileHeader
			+ blankGutter
			+ makeGutter(line) + printSourceLine
			+ blankGutter + pointer
			+ messageLine

	default:
		return header
			+ '\n' + fileHeader
			+ blankGutter
			+ lines.map(([lineNumber, line]) => makeGutter(lineNumber, true) + clean(line)).join('')
			+ blankGutter
			+ messageLine
	}
}

function formatMessage(message: string, margin: string, lineWidth: number) {
	const finalLineWidth = Math.min(lineWidth, 80)
	return message.split(/\n+/).map(paragraph => {
		const lines: string[] = []
		let line = margin
		const words = paragraph.split(/[ \t]+/)
		for (const word of words) {
			if (line.length + word.length + 1 > finalLineWidth) {
				lines.push(line)
				line = margin + ' ' + word
			}
			else line += ' ' + word
		}
		if (line !== margin)
			lines.push(line)

		return lines.join('')
	}).join('\n')
}
