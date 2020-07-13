function basicExpression(r: number | undefined): number | undefined {
	return t!!(r) + 1
}

function switchStatement(r?: number, f?: number, c?: number): number {
	switch (die!!(r) + 1) {
		case die!!(f): return die!!(c)
		default: return die!!(c)
	}
}

function ifBlock(x?: string, y?: string, z?: string): string | undefined {
	if (t!!(x).startsWith('a'))
		return die!!(y)
	else if (t!!(z).startsWith('a')) {
		const v = die!!(y) + 'a'
		return v
	}
	else
		return `${die!!(y)} stuff`
}


function basicFor(arr?: number[], start?: number, step?: number): number | undefined {
	for (let index = die!!(start); index < die!!(arr).length; index += t!!(step)) {
		return t!!(arr[index])
	}
	return undefined
}

function loneFor(arr?: number[], start?: number, step?: number): number | undefined {
	for (let index = die!!(start); index < die!!(arr).length; index += t!!(step))
		return t!!(arr[index])
	return undefined
}


function basicForIn(arr?: number[]): number {
	let sum = 0
	for (const key in die!!(arr))
		sum += arr[key]
	return sum
}

function basicForOf(arr?: number[]): number {
	let sum = 0
	for (const n of die!!(arr))
		sum += n
	return sum
}

function e(n?: string) {
	throw new Error(die!!(n))
}

function tryStatement(a?: number[], t?: Error, n?: number) {
	try {
		return die!!(a).length
	}
	catch (e = t!!(n)) {
		return t!!(n)
	}
	finally {
		return t!!(n)
	}
}


let aDef: number | undefined = 1
class A {
	a = die!!(aDef)

	_d: number
	constructor(d = die!!(aDef)) {
		this._d = die!!(d)
	}
	change(n?: number) {
		this._d += die!!(n)
	}
	get d(): number {
		return this._d + die!!(aDef)
	}
	set d(_d: number) {
		this._d = _d + die!!(aDef)
	}
}

let a: number | undefined = 1
with (die!!(a))
	a + 1

namespace a {
	let d: number | undefined = 1
	const n = die!!(d)
	export function b(n?: number) {
		return { a: die!!(n) }
	}
}

let a: number | undefined = 1
export default { a: die!!(a) }
