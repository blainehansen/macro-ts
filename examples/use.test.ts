import 'mocha'
import { expect } from 'chai'
import {
	add, yo_yo,
	basicExpression, switchStatement, ifBlock, basicFor, loneFor, basicForIn, basicForOf, err, tryStatement,
	A, a, obj, getObj,
} from './use'
import aObj from './use'

describe('examples', () => {
	it('add', () => {
		expect(add(1)).equal(2)
		expect(() => add(undefined)).throw()
	})

	it('yo', () => {
		expect(yo_yo()).equal('yo')
	})

	it('basicExpression', () => {
		expect(basicExpression(1) === 2).true
		expect(basicExpression(undefined) === undefined).true
	})

	it('switchStatement', () => {
		expect(switchStatement(1, 1, 1) === '2').true
		expect(switchStatement(1, 1, undefined) === undefined).true
		expect(switchStatement(1, 2, 1) === '1').true
		expect(switchStatement(1, 2, undefined) === undefined).true

		expect(switchStatement() === undefined).true
		expect(switchStatement(1, undefined, 1) === undefined).true
		expect(switchStatement(1, undefined, 2) === undefined).true
		expect(switchStatement(undefined, 2, 1) === undefined).true
	})

	it('ifBlock', () => {
		expect(ifBlock() === undefined).true

		expect(ifBlock('a', 'y', 'z') === 'z').true
		expect(ifBlock('a', undefined, 'z') === 'z').true
		expect(ifBlock('a', undefined, undefined) === undefined).true

		expect(ifBlock('x', 'a', 'z') === 'z a').true
		expect(ifBlock('x', 'a', undefined) === undefined).true

		expect(ifBlock('x', 'y', 'z') === 'z stuff').true
		expect(ifBlock('x', 'y', undefined) === undefined).true
	})

	it('basicFor', () => {
		expect(basicFor() === undefined).true
		expect(basicFor([1]) === undefined).true
		expect(basicFor([], 0) === undefined).true
		expect(basicFor([1], 1) === undefined).true

		expect(basicFor([1], 0) === 2).true
		expect(basicFor([1, 2], 1) === 3).true
	})

	it('loneFor', () => {
		expect(loneFor() === undefined).true
		expect(loneFor([1]) === undefined).true
		expect(loneFor([], 0) === undefined).true
		expect(loneFor([1], 1) === undefined).true

		expect(loneFor([1], 0) === 2).true
		expect(loneFor([1, 2], 1) === 3).true
	})

	it('basicForIn', () => {
		expect(basicForIn() === undefined).true
		expect(basicForIn(undefined) === undefined).true

		expect(basicForIn([]) === 0).true
		expect(basicForIn([1]) === 1).true
		expect(basicForIn([1, 1]) === 2).true
	})

	it('basicForOf', () => {
		expect(basicForOf() === undefined).true
		expect(basicForOf(undefined) === undefined).true

		expect(basicForOf([]) === 0).true
		expect(basicForOf([1]) === 1).true
		expect(basicForOf([1, 1]) === 2).true
	})

	it('err', () => {
		expect(err() === undefined).true
		expect(err(undefined) === undefined).true
		expect(() => err('a')).throw()
	})

	it('tryStatement', () => {
		expect(() => tryStatement(undefined, undefined, undefined)).throw()
		expect(() => tryStatement(undefined, undefined, 1)).throw()

		expect(tryStatement([], undefined, undefined) === 0).true
		expect(tryStatement(undefined, 1, undefined) === undefined).true
		expect(tryStatement(undefined, 1, 1) === 2).true
	})

	it('A', () => {
		expect(() => { const a = new A(1); a.change(undefined) }).throw()

		const a = new A(1)
		expect(a.a === 1).true
		expect(a.d === 2).true
		a.d = 2
		expect(a.d === 3).true
		a.change(3)
		expect(a.d === 4).true

		const b = new A()
		expect(b.d === 2).true
	})

	it('a', () => {
		expect(a.b() === undefined).true
		expect(a.b(1)).eql({ a: 2 })
	})

	it('aObj', () => {
		expect(aObj).eql({ z: 1 })
	})

	it('obj', () => {
		expect(obj.a.toUpperCase() === 'A').true
		expect(obj.b.toFixed(1) === '1.0').true
	})

	it('getObj', () => {
		expect(getObj().a.toUpperCase() === 'A').true
		expect(getObj().b.toFixed(1) === '1.0').true
	})
})
