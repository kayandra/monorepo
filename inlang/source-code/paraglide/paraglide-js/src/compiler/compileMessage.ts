import type { MessageNested, Variant } from "@inlang/sdk2"
import type { Registry } from "./registry.js"
import { compilePattern } from "./compilePattern.js"
import { escapeForDoubleQuoteString } from "../services/codegen/escape.js"
import { compileExpression } from "./compileExpression.js"
import { mergeTypeRestrictions, type Compilation } from "./types.js"
import { inputsType } from "./inputsType.js"
import { jsIdentifier } from "~/services/codegen/identifier.js"

/**
 * Returns the compiled message as a string
 *
 * @example
 * @param message The message to compile
 * @returns (inputs) => string
 */
export const compileMessage = (
	message: MessageNested,
	registry: Registry
): Compilation<MessageNested> => {
	// return empty string instead?
	if (message.variants.length == 0) throw new Error("Message must have at least one variant")
	const hasMultipleVariants = message.variants.length > 1
	return addTypes(
		hasMultipleVariants
			? compileMessageWithMultipleVariants(message, registry)
			: compileMessageWithOneVariant(message, registry)
	)
}

function compileMessageWithOneVariant(
	message: MessageNested,
	registry: Registry
): Compilation<MessageNested> {
	const variant = message.variants[0]
	if (!variant || message.variants.length !== 1)
		throw new Error("Message must have exactly one variant")
	const hasInputs = message.declarations.some((decl) => decl.type === "input")
	const compiledPattern = compilePattern(message.locale, variant.pattern, registry)
	const code = `const ${jsIdentifier(message.id)} = (${hasInputs ? "inputs" : ""}) => ${compiledPattern.code}`
	return { code, typeRestrictions: compiledPattern.typeRestrictions, source: message }
}

function compileMessageWithMultipleVariants(
	message: MessageNested,
	registry: Registry
): Compilation<MessageNested> {
	if (message.variants.length <= 1) throw new Error("Message must have more than one variant")
	const hasInputs = message.declarations.some((decl) => decl.type === "input")

	const compiledSelectors = message.selectors.map((selector) =>
		compileExpression(message.locale, selector, registry)
	)

	const selectorCode = `const selectors = [ ${compiledSelectors
		.map((sel) => sel.code)
		.join(", ")} ]`

	// TODO make sure that matchers use keys instead of indexes
	const compiledVariants = sortVariants(message.variants).map((variant): Compilation<Variant> => {
		const compiledPattern = compilePattern(message.locale, variant.pattern, registry)
		const typeRestrictions = compiledPattern.typeRestrictions

		// @ts-expect-error
		const allWildcards: boolean = variant.match.every((m: string) => m === "*")
		if (allWildcards)
			return { code: `return ${compiledPattern.code}`, typeRestrictions, source: variant }

		// @ts-expect-error
		const conditions: string[] = (variant.match as string[])
			.map((m, i) => {
				if (m === "*") return undefined
				// we use == instead of === to automatically convert to string if necessary
				return `selectors[${i}] == "${escapeForDoubleQuoteString(m)}"`
			})
			.filter((m) => m !== undefined)

		return {
			code: `if (${conditions.join(" && ")}) return ${compiledPattern.code}`,
			typeRestrictions,
			source: variant,
		}
	})

	const tr = [
		...compiledVariants.map((v) => v.typeRestrictions),
		...compiledSelectors.map((v) => v.typeRestrictions),
	].reduce(mergeTypeRestrictions, {})

	const code = `const ${jsIdentifier(message.id)} = (${hasInputs ? "inputs" : ""}) => {
	${selectorCode}
	${compiledVariants.map((l) => `\t${l.code}`).join("\n")}
}`

	return { code, typeRestrictions: tr, source: message }
}

function addTypes(compilation: Compilation<MessageNested>): Compilation<MessageNested> {
	// add types for the inputs
	const tr = structuredClone(compilation.typeRestrictions)
	for (const decl of compilation.source.declarations) {
		const name = decl.value.arg.name
		if (name in tr) continue
		tr[name] = "NonNullable<unknown>"
	}

	const code = `/**
 * ${inputsType(tr, false)}
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
${compilation.code}`

	return {
		...compilation,
		typeRestrictions: tr,
		code,
	}
}

/**
 * Sorts variants from most-specific to least-specific.
 *
 * @param variants
 */
function sortVariants(variants: Variant[]): Variant[] {
	function compareMatches(a: string, b: string): number {
		if (a === "*" && b === "*") return 0
		if (a === "*") 1
		if (b === "*") return -1
		return 0
	}

	// @ts-ignore
	return variants.toSorted((a, b) => {
		let i = 0
		// @ts-ignore
		while (i < Math.min(a.match.length, b.match.length)) {
			// @ts-ignore
			const cmp = compareMatches(a.match[i], b.match[i])
			if (cmp !== 0) return cmp
			i += 1
		}
		return 0
	})
}
