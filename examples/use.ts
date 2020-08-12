@yo!!()
export function yo() {
	return 'yo'
}

export function add(r: number | undefined): number {
	return required!!(r) + 1
}

export function basicExpression(r: number | undefined): number | undefined {
	return undef!!(r) + 1
}

export function switchStatement(r?: number, f?: number, c?: number): number {
	switch (required!!(r) + 1) {
		case required!!(f): return required!!(c)
		default: return required!!(c)
	}
}

export function ifBlock(x?: string, y?: string, z?: string): string | undefined {
	if (t!!(x).startsWith('a'))
		return required!!(y)
	else if (t!!(z).startsWith('a')) {
		const v = required!!(y) + 'a'
		return v
	}
	else
		return `${required!!(y)} stuff`
}


export function basicFor(arr?: number[], start?: number, step?: number): number | undefined {
	for (let index = required!!(start); index < required!!(arr).length; index += t!!(step)) {
		return t!!(arr[index])
	}
	return undefined
}

export function loneFor(arr?: number[], start?: number, step?: number): number | undefined {
	for (let index = required!!(start); index < required!!(arr).length; index += t!!(step))
		return t!!(arr[index])
	return undefined
}


export function basicForIn(arr?: number[]): number {
	let sum = 0
	for (const key in required!!(arr))
		sum += arr[key]
	return sum
}

export function basicForOf(arr?: number[]): number {
	let sum = 0
	for (const n of required!!(arr))
		sum += n
	return sum
}

export function e(n?: string) {
	throw new Error(required!!(n))
}

export function tryStatement(a?: number[], t?: Error, n?: number): number | undefined {
	try {
		return required!!(a).length
	}
	catch (e = undef!!(n)) {
		return undef!!(n)
	}
	finally {
		return undef!!(n)
	}
}


let aDef: number | undefined = 1
export class A {
	a = required!!(aDef)

	_d: number
	constructor(d = required!!(aDef)) {
		this._d = required!!(d)
	}
	change(n?: number) {
		this._d += required!!(n)
	}
	get d(): number {
		return this._d + required!!(aDef)
	}
	set d(_d: number) {
		this._d = _d + required!!(aDef)
	}
}

// let a: number | undefined = 1
// with (required!!(a))
// 	a + 1

export namespace a {
	let d: number | undefined = 1
	const n = required!!(d)
	export function b(n?: number) {
		return { a: required!!(n) }
	}
}

let a: number | undefined = 1
export default { a: required!!(a) }

import local from yaml!!('./use.yaml')
export obj from yaml!!('./use.yaml')

export function getObj() {
	return { a: local.a, b: local.b } as { a: string, b: number }
}
