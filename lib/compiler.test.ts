import ts = require('typescript')

import { Dict } from './utils'
import { Macro } from './transformer'

const macros: Dict<Macro> = {
	die: { type: 'function', macro: args => {
		if (args.length !== 1) throw new Error()
		const target = args[0]
		return {
			prepend: [ts.createIf(
				ts.createBinary(target, ts.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken), ts.createIdentifier('undefined')),
				ts.createThrow(ts.createNew(ts.createIdentifier('Error'), undefined, [])), undefined,
			)],
			expression: target,
			append: [],
		}
	}},

	t: { type: 'function', macro: args => {
		if (args.length !== 1) throw new Error()
		const target = args[0]
		return {
			prepend: [ts.createIf(
				ts.createBinary(target, ts.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken), ts.createIdentifier('undefined')),
				// ts.createCall(
				// 	ts.createPropertyAccess(target, ts.createIdentifier('is_err')),
				// 	undefined, [],
				// ),
				ts.createReturn(ts.createIdentifier('undefined')), undefined,
			)],
			// expression: ts.createPropertyAccess(target, ts.createIdentifier('value')),
			expression: target,
			append: [],
		}
	}},

	y: { type: 'import', macro: (path, clause, args, typeArgs) => {
		if (args.length !== 1) throw new Error()
		const typeName = args[0]
		if (!ts.isIdentifier(typeName)) throw new Error()
		if (
			!clause
			|| clause.isExport
			|| clause.clause.name
			|| !clause.clause.namedBindings
			|| !ts.isNamespaceImport(clause.clause.namedBindings)
		) throw new Error()

		return { statements: [
			ts.createModuleDeclaration(
				undefined,
				undefined,
				clause.clause.namedBindings.name,
				ts.createModuleBlock([
					ts.createTypeAliasDeclaration(
						undefined,
						[ts.createModifier(ts.SyntaxKind.ExportKeyword)],
						typeName,
						undefined,
						ts.createLiteralTypeNode(ts.createStringLiteral(path)),
					),
				]),
				ts.NodeFlags.Namespace,
			),
		] }
	}},
}

// describe('compiler', () => {

// })


// function basicExpression(r: number | undefined): number | undefined {
// 	return t!!(r) + 1
// }

// function switchStatement(r?: number, f?: number, c?: number): number {
// 	switch (die!!(r) + 1) {
// 		case die!!(f): return die!!(c)
// 		default: return die!!(c)
// 	}
// }

// function ifBlock(x?: string, y?: string, z?: string): string | undefined {
// 	if (t!!(x).startsWith('a'))
// 		return die!!(y)
// 	else if (t!!(z).startsWith('a')) {
// 		const v = die!!(y) + 'a'
// 		return v
// 	}
// 	else
// 		return `${die!!(y)} stuff`
// }


// function basicFor(arr?: number[], start?: number, step?: number): number | undefined {
// 	for (let index = die!!(start); index < die!!(arr).length; index += t!!(step)) {
// 		return t!!(arr[index])
// 	}
// 	return undefined
// }

// function loneFor(arr?: number[], start?: number, step?: number): number | undefined {
// 	for (let index = die!!(start); index < die!!(arr).length; index += t!!(step))
// 		return t!!(arr[index])
// 	return undefined
// }


// function basicForIn(arr?: number[]): number {
// 	let sum = 0
// 	for (const key in die!!(arr))
// 		sum += arr[key]
// 	return sum
// }

// function basicForOf(arr?: number[]): number {
// 	let sum = 0
// 	for (const n of die!!(arr))
// 		sum += n
// 	return sum
// }

// function e(n?: string) {
// 	throw new Error(die!!(n))
// }

// function tryStatement(a?: number[], t?: Error, n?: number) {
// 	try {
// 		return die!!(a).length
// 	}
// 	catch (e = t!!(n)) {
// 		return t!!(n)
// 	}
// 	finally {
// 		return t!!(n)
// 	}
// }


// let aDef: number | undefined = 1
// class A {
// 	a = die!!(aDef)

// 	_d: number
// 	constructor(d = die!!(aDef)) {
// 		this._d = die!!(d)
// 	}
// 	change(n?: number) {
// 		this._d += die!!(n)
// 	}
// 	get d(): number {
// 		return this._d + die!!(aDef)
// 	}
// 	set d(_d: number) {
// 		this._d = _d + die!!(aDef)
// 	}
// }

// let a: number | undefined = 1
// with (die!!(a))
// 	a + 1

// namespace a {
// 	let d: number | undefined = 1
// 	const n = die!!(d)
// 	export function b(n?: number) {
// 		return { a: die!!(n) }
// 	}
// }

// let a: number | undefined = 1
// export default { a: die!!(a) }

// import * as f from y!!('metrics', Metric)
// const a: f.Metric = 'metrics'
