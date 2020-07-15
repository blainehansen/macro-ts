export type Dict<T> = { [key: string]: T | undefined }

export type UnionKeys<T> = T extends T ? keyof T : never
export type OmitVariants<U, K extends UnionKeys<U>, V extends U[K]> = U extends U
	? U[K] extends V ? never : U
	: never
export type PickVariants<U, K extends UnionKeys<U>, V extends U[K]> = U extends U
	? U[K] extends V ? U : never
	: never
