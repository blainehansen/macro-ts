import ts = require('typescript')
import {
  FunctionMacro, BlockMacro,
  DecoratorMacro, ImportMacro,
} from '../lib/transformer'

export const required = FunctionMacro(args => {
	if (args.length !== 1) throw new Error("some helpful message")
	const target = args[0]
	return {
		prepend: [ts.createIf(
			ts.createBinary(
				target,
				ts.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
				ts.createIdentifier('undefined'),
			),
			ts.createThrow(
				ts.createNew(ts.createIdentifier('Error'), undefined, []),
			),
			undefined,
		)],
		expression: target,
		append: [],
	}
})

export const undef = FunctionMacro(args => {
	if (args.length !== 1) throw new Error("some helpful message")
	const target = args[0]
	return {
		prepend: [ts.createIf(
			ts.createBinary(
				target,
				ts.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
				ts.createIdentifier('undefined'),
			),
			ts.createReturn(ts.createIdentifier('undefined')),
			undefined,
		)],
		expression: target,
		append: [],
	}
})

export const ok = FunctionMacro(args => {
	if (args.length !== 1) throw new Error()
	const target = args[0]
	return {
		prepend: [ts.createIf(
			ts.createCall(ts.createPropertyAccess(target, ts.createIdentifier('is_err')), undefined, []),
			ts.createReturn(target), undefined,
		)],
		expression: ts.createPropertyAccess(target, ts.createIdentifier('value')),
		append: [],
	}
})

export const yo = DecoratorMacro(statement => {
	if (!ts.isFunctionDeclaration(statement)) throw new Error()
	if (statement.name === undefined) throw new Error()

	const newName = statement.name.text + '_yo'
	const replacement = ts.updateFunctionDeclaration(
		statement, undefined, statement.modifiers, statement.asteriskToken, ts.createIdentifier(newName),
		statement.typeParameters, statement.parameters, statement.type, statement.body,
	)
	return { replacement }
})


export const repeat = BlockMacro(args => {
	const [times, statement] = args
	if (
		!times || !statement
		|| !ts.isExpressionStatement(times)
		|| !ts.isBinaryExpression(times.expression)
		|| !ts.isIdentifier(times.expression.left)
		|| !ts.isIdentifier(times.expression.left)
		|| times.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken
		|| !ts.isNumericLiteral(times.expression.right)
	) throw new Error("some helpful message")

	const repetitions = parseInt(times.expression.right.text)
	const statements = [...Array(repetitions)].map(() => statement)
	return statements
})


export const creator = DecoratorMacro(statement => {
  if (
    !ts.isTypeAliasDeclaration(statement)
    || !ts.isTypeLiteralNode(statement.type)
  ) throw new Error("some helpful message")

  const members = statement.type.members.map(member => {
    if (
      !ts.isPropertySignature(member)
      || !member.type
      || !ts.isIdentifier(member.name)
    ) throw new Error("some helpful message")

    return { name: member.name, type: member.type }
  })

  const parameters = members.map(({ name, type }) => {
    return ts.createParameter(
      undefined, undefined, undefined, name,
      undefined, type, undefined,
    )
  })
  const properties = members.map(({ name }) => {
    return ts.createShorthandPropertyAssignment(name, undefined)
  })

  const creator = ts.createFunctionDeclaration(
    undefined, undefined, undefined,
    statement.name,
    statement.typeParameters, parameters,
    ts.createTypeReferenceNode(statement.name, undefined),
    ts.createBlock([
      ts.createReturn(
        ts.createObjectLiteral(properties, false),
      ),
    ], true),
  )

  return { replacement: statement, additional: [creator] }
})


import YAML = require('js-yaml')
export const yaml = ImportMacro((_ctx, _targetPath, targetSource) => {
  const obj = YAML.safeLoad(targetSource)
  if (typeof obj !== 'object')
    throw new Error("some helpful message")

  const properties = Object.entries(obj).map(([key, value]) => {
    return ts.createPropertyAssignment(
      ts.createIdentifier(key),
      // this is a cool hack,
      // typescript just passes "identifiers" along exactly!
      ts.createIdentifier(JSON.stringify(value)),
    )
  })
  const statement = ts.createExportAssignment(
    undefined, undefined,
    undefined, ts.createObjectLiteral(properties, false),
  )

  return { statements: [statement] }
})
