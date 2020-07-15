const macros: Dict<Macro> = {
	die: { type: 'function', macro: args => {
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
	}},

	t: { type: 'function', macro: args => {
		if (args.length !== 1) throw new Error()
		const target = args[0]
		return {
			prepend: [ts.createIf(
				ts.createBinary(target, ts.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken), ts.createIdentifier('undefined')),
				// ts.createCall(
				// 	ts.createPropertyAccess(target, ts.createIdentifier('is_err')),
				// 	undefined, [],
				// ),
				ts.createReturn(ts.createIdentifier('undefined')), undefined,
			)],
			// expression: ts.createPropertyAccess(target, ts.createIdentifier('value')),
			expression: target,
			append: [],
		}
	}},

	y: { type: 'import', macro: (path, clause, args, typeArgs) => {
		if (args.length !== 1) throw new Error()
		const typeName = args[0]
		if (!ts.isIdentifier(typeName)) throw new Error()
		if (
			!clause
			|| clause.isExport
			|| clause.clause.name
			|| !clause.clause.namedBindings
			|| !ts.isNamespaceImport(clause.clause.namedBindings)
		) throw new Error()

		return { statements: [
			ts.createModuleDeclaration(
				undefined,
				undefined,
				clause.clause.namedBindings.name,
				ts.createModuleBlock([
					ts.createTypeAliasDeclaration(
						undefined,
						[ts.createModifier(ts.SyntaxKind.ExportKeyword)],
						typeName,
						undefined,
						ts.createLiteralTypeNode(ts.createStringLiteral(path)),
					),
				]),
				ts.NodeFlags.Namespace,
			),
		] }
	}},
}
