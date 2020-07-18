export type Dict<T> = { [key: string]: T }

export type UnionKeys<T> = T extends T ? keyof T : never
export type OmitVariants<U, K extends UnionKeys<U>, V extends U[K]> = U extends U
	? U[K] extends V ? never : U
	: never
export type PickVariants<U, K extends UnionKeys<U>, V extends U[K]> = U extends U
	? U[K] extends V ? U : never
	: never

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

export abstract class AbstractFileSystem {
	// abstract fileExists(path: string): Promise<boolean>
	abstract fileExists(path: string): boolean
	// abstract readFile(path: string): Promise<string | undefined>
	abstract readFile(path: string): string | undefined
	// abstract readFile(path: string, utf: true): Promise<string | undefined>
	abstract readFile(path: string, utf: true): string | undefined
	// abstract readFile(path: string, utf: false): Promise<Buffer | undefined>
	abstract readFile(path: string, utf: false): Buffer | undefined
	// abstract writeFile(path: string, content: string | Buffer): Promise<void>
	abstract writeFile(path: string, content: string | Buffer): void

	abstract getWorkingDirectory(): string
	abstract dirname(path: string): string
	abstract basename(path: string): string
	abstract relative(fromPath: string, toPath: string): string
}
