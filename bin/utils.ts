export function fatal(message: string): never {
	console.error(message)
	return process.exit(1)
}
export function exit(message: string): never {
	console.log(message)
	return process.exit(0)
}
