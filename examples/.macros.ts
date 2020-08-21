import ts = require('typescript')
import {
  FunctionMacro, BlockMacro,
  DecoratorMacro, ImportMacro,
} from '../lib/'

export const required = FunctionMacro((ctx, args) => {
	if (args.length !== 1)
		return ctx.TsNodeErr(args, 'Incorrect arguments', 'The "required" macro accepts exactly one argument.')

	const target = args[0]
	return ctx.Ok({
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
	})
})

export const undef = FunctionMacro((ctx, args) => {
	if (args.length !== 1)
		return ctx.TsNodeErr(args, 'Incorrect arguments', 'The "undef" macro accepts exactly one argument.')

	const target = args[0]
	return ctx.Ok({
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
	})
})

export const ok = FunctionMacro((ctx, args) => {
	if (args.length !== 1)
		return ctx.TsNodeErr(args, 'Incorrect arguments', 'The "ok" macro accepts exactly one argument.')
	const target = args[0]
	return ctx.Ok({
		prepend: [ts.createIf(
			ts.createCall(ts.createPropertyAccess(target, ts.createIdentifier('is_err')), undefined, []),
			ts.createReturn(target), undefined,
		)],
		expression: ts.createPropertyAccess(target, ts.createIdentifier('value')),
		append: [],
	})
})

export const yo = DecoratorMacro((ctx, statement) => {
	if (!ts.isFunctionDeclaration(statement))
		return ctx.TsNodeErr(statement, 'Not a function', 'The "yo" macro can only decorate functions.')
	if (statement.name === undefined)
		return ctx.TsNodeErr(statement, 'No function name', 'The "yo" macro can only decorate functions with a name.')

	const newName = statement.name.text + '_yo'
	const replacement = ts.updateFunctionDeclaration(
		statement, undefined, statement.modifiers, statement.asteriskToken, ts.createIdentifier(newName),
		statement.typeParameters, statement.parameters, statement.type, statement.body,
	)
	return ctx.Ok({ replacement })
})


export const repeat = BlockMacro((ctx, inputStatements) => {
	const [times, statement] = inputStatements
	if (
		!times || !statement
		|| !ts.isExpressionStatement(times)
		|| !ts.isBinaryExpression(times.expression)
		|| !ts.isIdentifier(times.expression.left)
		|| times.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken
		|| !ts.isNumericLiteral(times.expression.right)
	)
		return ctx.TsNodeErr(inputStatements, 'Invalid repeat', `The "repeat" macro isn't being used correctly.`)

	const repetitions = parseInt(times.expression.right.text)
	const statements = [...Array(repetitions)].map(() => statement)
	return ctx.Ok(statements)
})


export const creator = DecoratorMacro((ctx, statement) => {
  if (
    !ts.isTypeAliasDeclaration(statement)
    || !ts.isTypeLiteralNode(statement.type)
  )
		return ctx.TsNodeErr(statement, 'Not a type literal', `The "creator" macro isn't being used correctly.`)

	const members: { name: ts.Identifier, type: ts.TypeNode }[] = []
	for (const member of statement.type.members) {
    if (
      !ts.isPropertySignature(member)
      || !member.type
      || !ts.isIdentifier(member.name)
    )
			return ctx.TsNodeErr(member, 'Invalid member', `The "creator" macro requires all members to be simple.`)

    members.push({ name: member.name, type: member.type })
	}

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

  return ctx.Ok({ replacement: statement, additional: [creator] })
})


import YAML = require('js-yaml')
export const yaml = ImportMacro((ctx, targetSource, targetPath) => {
  const obj = YAML.safeLoad(targetSource)
  if (typeof obj !== 'object')
  	return ctx.Err(targetPath, 'Invalid yaml', `The "yaml" macro requires the yaml contents to be an object.`)

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

  return ctx.Ok({ statements: [statement] })
})
