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

export function switchStatement(a?: number, b?: number, c?: number): string | undefined {
	switch (undef!!(a)) {
		case undef!!(b): return (undef!!(c) + b).toFixed(0)
		default: return undef!!(c).toFixed(0)
	}
}

export function ifBlock(x?: string, y?: string, z?: string): string | undefined {
	if (undef!!(x).startsWith('a'))
		return undef!!(z)
	else if (undef!!(y).startsWith('a')) {
		const v = undef!!(z) + ' a'
		return v
	}
	else
		return `${undef!!(z)} stuff`
}


export function basicFor(arr?: number[], start?: number): number | undefined {
	for (let index = undef!!(start); index < undef!!(arr).length; index++) {
		return undef!!(arr[index]) + 1
	}
	return undefined
}

export function loneFor(arr?: number[], start?: number): number | undefined {
	for (let index = undef!!(start); index < undef!!(arr).length; index++)
		return undef!!(arr[index]) + 1
	return undefined
}


export function basicForIn(arr?: number[]): number | undefined {
	let sum = 0
	for (const key in undef!!(arr))
		sum += arr[key]
	return sum
}

export function basicForOf(arr?: number[]): number | undefined {
	let sum = 0
	for (const n of undef!!(arr))
		sum += n
	return sum
}

export function err(n?: string) {
	throw new Error(undef!!(n))
}

export function tryStatement(a?: number[], t?: number, n?: number): number | undefined {
	let result = 0
	try {
		return required!!(a).length
	}
	catch (e) {
		result += required!!(t)
	}

	return result + undef!!(n)
}


let aDef: number | undefined = 1
export class A {
	a = required!!(aDef)

	_d: number
	constructor(d = required!!(aDef)) {
		this._d = required!!(d)
	}
	change(n?: number) {
		this._d = required!!(n)
	}
	get d(): number {
		return this._d + required!!(this.a)
	}
	set d(_d: number) {
		this._d = _d
	}
}

export namespace a {
	let d: number | undefined = 1
	export function b(a?: number) {
		return { a: undef!!(a) + undef!!(d) }
	}
}

let z: number | undefined = 1
export default { z: required!!(z) }

import local from yaml!!('./use.yaml')
export { default as obj } from yaml!!('./use.yaml')

export function getObj() {
	return { a: local.a, b: local.b }
}
