import * as c from '@ts-std/codec'
import { Result as _Result, Ok, Err } from '@ts-std/monads'

export type Dict<T> = { [key: string]: T }
export function tuple<L extends any[]>(...items: L) {
	return items
}
export function exec<T>(fn: () => T): T {
	return fn()
}

export type UnionKeys<T> = T extends T ? keyof T : never
export type OmitVariants<U, K extends UnionKeys<U>, V extends U[K]> = U extends U
	? U[K] extends V ? never : U
	: never
export type PickVariants<U, K extends UnionKeys<U>, V extends U[K]> = U extends U
	? U[K] extends V ? U : never
	: never

export type UnboxArray<A extends unknown[]> = A extends (infer T)[] ? T : never

export class Registry<T> {
	protected items: Dict<T> = {}
	peek(key: string) {
		return key in this.items
	}
	take(key: string): T | undefined {
		const item = this.items[key]
		delete this.items[key]
		return item
	}
	put(key: string, item: T) {
		this.items[key] = item
	}
}

export class Cache<T> {
	protected map = new Map<string, T>()

	has(key: string) {
		return this.map.has(key)
	}
	get(key: string) {
		return this.map.get(key)
	}
	set(key: string, value: T): T {
		this.map.set(key, value)
		return value
	}
}

export function cachedLookup<T>(fn: (key: string) => T){
	const cache = new Map<string, T>()

	return (key: string): T => {
		const item = cache.get(key)
		if (item !== undefined) return item

		const actual = fn(key)
		cache.set(key, actual)
		return actual
	}
}

export type NonEmpty<T> = [T, ...T[]]
export namespace NonEmpty {
	export function decoder<T>(decoder: c.Decoder<T>): c.Decoder<NonEmpty<T>> {
		const arrayDecoder = c.array(decoder)
		return c.wrap(`NonEmpty<${decoder.name}>`, input => {
			const result = arrayDecoder.decode(input)
			if (result.is_err()) return result
			const values = result.value
			if (values.length === 0) return Err(`array empty, expected at least one item`)
			return Ok([values[0], ...values.slice(1)])
		})
	}

	export function flattenInto<T>(item: T | NonEmpty<T>): NonEmpty<T> {
		return Array.isArray(item) ? item : [item]
	}
}

export type NonEmptyOrSingle<T> = T | NonEmpty<T>
export namespace NonEmptyOrSingle {
	export function decoder<T>(decoder: c.Decoder<T>): c.Decoder<NonEmptyOrSingle<T>> {
		return c.union(decoder, NonEmpty.decoder(decoder))
	}
}

export function longestMatchingStem(value: string, stems: string[]): string | undefined {
	const longest = { length: 0, stem: undefined as string | undefined }
	for (const stem of stems) {
		const stemLength = stem.length
		if (stemLength <= longest.length || !value.startsWith(stem)) continue

		longest.stem = stem
		longest.length = stemLength
	}

	return longest.stem
}

// export abstract class AbstractFileSystem {
// 	// abstract fileExists(path: string): Promise<boolean>
// 	abstract fileExists(path: string): boolean
// 	// abstract readFile(path: string): Promise<string | undefined>
// 	abstract readFile(path: string): string | undefined
// 	// abstract readFile(path: string, utf: true): Promise<string | undefined>
// 	abstract readFile(path: string, utf: true): string | undefined
// 	// abstract readFile(path: string, utf: false): Promise<Buffer | undefined>
// 	abstract readFile(path: string, utf: false): Buffer | undefined
// 	// abstract writeFile(path: string, content: string | Buffer): Promise<void>
// 	abstract writeFile(path: string, content: string | Buffer): void

// 	abstract getWorkingDirectory(): string
// 	abstract dirname(path: string): string
// 	abstract basename(path: string): string
// 	abstract relative(fromPath: string, toPath: string): string
// }

// import * as nodepath from 'path'
// class NodeMemoryFileSystem extends AbstractFileSystem {
// 	protected files: Dict<string | Buffer> = {}

// 	fileExists(path: string) { return path in this.files }

// 	readFile(path: string): string | undefined
// 	readFile(path: string, encoding: 'utf8'): string | undefined
// 	readFile(path: string, encoding: string): Buffer | undefined
// 	readFile(path: string, encoding = 'utf8') {
// 		const file = this.files[path]
// 		if (file === undefined) return undefined
// 		if (typeof file === 'string')
// 		if (encoding === undefined || encoding === 'utf8')
// 	}

// 	writeFile(path: string, content: string | Buffer) { this.files[path] = content }
// 	dirname(path: string) { return nodepath.dirname(path) }
// 	basename(path: string) { return nodepath.basename(path) }
// 	relative(fromPath: string, toPath: string) { return nodepath.relative(fromPath, toPath) }
// }
