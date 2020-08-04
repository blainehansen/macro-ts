function add(r: number | undefined) {
	return u!!(r) + 1
}

console.log(add(1))
console.log(add(undefined))

@yo!!()
function yo() {
	console.log('yo')
}

yo_yo()
