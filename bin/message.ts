import { fatal } from './utils'
import { NonEmpty } from '../lib/utils'
import { Transformer } from '../lib/transformer'
import { formatDiagnostics, SpanError, SpanWarning } from '../lib/message'

export function fatalErrors(errors: NonEmpty<SpanError>, warnings: SpanWarning[]): never {
	const message = formatDiagnostics(errors, warnings, process.stdout.columns)
	fatal(message)
}

export function warn(warnings: SpanWarning[]) {
	if (warnings.length === 0) return
	const message = formatDiagnostics([], warnings, process.stdout.columns)
	console.warn(message)
}

export function assertSuccess(transformer: Transformer<unknown>) {
	const [macrosResult, warnings] = transformer.checkSuccess()
	if (macrosResult.is_err())
		fatalErrors(macrosResult.error, warnings)
	else
		warn(warnings)
}
