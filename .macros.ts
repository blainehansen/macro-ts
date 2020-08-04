import ts = require('typescript')
import { BlockMacro, FunctionMacro, DecoratorMacro, ImportMacro } from './lib/transformer'

export const macros = {
	die: FunctionMacro(args => {
		if (args.length !== 1) throw new Error()
		const target = args[0]
		return {
			prepend: [ts.createIf(
				ts.createBinary(target, ts.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken), ts.createIdentifier('undefined')),
				ts.createThrow(ts.createNew(ts.createIdentifier('Error'), undefined, [])), undefined,
			)],
			expression: target,
			append: [],
		}
	}),

	u: FunctionMacro(args => {
		if (args.length !== 1) throw new Error()
		const target = args[0]
		return {
			prepend: [ts.createIf(
				ts.createBinary(target, ts.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken), ts.createIdentifier('undefined')),
				ts.createReturn(ts.createIdentifier('undefined')), undefined,
			)],
			expression: target,
			append: [],
		}
	}),

	t: FunctionMacro(args => {
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
	}),

	yo: DecoratorMacro(statement => {
		if (!ts.isFunctionDeclaration(statement)) throw new Error()
		if (statement.name === undefined) throw new Error()

		const newName = statement.name.text + '_yo'
		return [ts.updateFunctionDeclaration(
			statement, undefined, statement.modifiers, statement.asteriskToken, ts.createIdentifier(newName),
			statement.typeParameters, statement.parameters, statement.type, statement.body,
		)]
	}),

	// y: ImportMacro<undefined>((ctx, targetPath, targetSource) => {
	// 	if (args.length !== 1) throw new Error()
	// 	const typeName = args[0]
	// 	if (!ts.isIdentifier(typeName)) throw new Error()
	// 	if (
	// 		!clause
	// 		|| clause.isExport
	// 		|| clause.clause.name
	// 		|| !clause.clause.namedBindings
	// 		|| !ts.isNamespaceImport(clause.clause.namedBindings)
	// 	) throw new Error()

	// 	return { statements: [
	// 		ts.createModuleDeclaration(
	// 			undefined,
	// 			undefined,
	// 			clause.clause.namedBindings.name,
	// 			ts.createModuleBlock([
	// 				ts.createTypeAliasDeclaration(
	// 					undefined,
	// 					[ts.createModifier(ts.SyntaxKind.ExportKeyword)],
	// 					typeName,
	// 					undefined,
	// 					ts.createLiteralTypeNode(ts.createStringLiteral(path)),
	// 				),
	// 			]),
	// 			ts.NodeFlags.Namespace,
	// 		) as ts.Statement,
	// 	] }
	// }),
}
