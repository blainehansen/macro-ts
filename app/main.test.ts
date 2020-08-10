import 'mocha'
import { expect } from 'chai'

import { add, yo_yo } from './main'

describe('app/main', () => {
	it('add', () => {
		expect(add(1)).equal(2)
		expect(add(undefined)).undefined
	})

	it('yo', () => {
		expect(yo_yo()).equal('yo')
	})
})
