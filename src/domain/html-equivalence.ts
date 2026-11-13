import { createDocument } from "@mixmark-io/domino"

/**
 * True when two HTML strings parse to the same DOM: the same elements in the
 * same order, the same attributes with the same values, and the same text.
 *
 * Only spelling the parser erases is ignored: which entity encodes a character
 * (`&#34;`, `&quot;` or `"`), `<br>` against `<br />`, attribute order and
 * quoting. Everything a browser could render differently still counts,
 * including whitespace, empty elements, a trailing `<br />`, and `<b>`
 * against `<strong>`.
 */
export function sameHtml(a: string, b: string): boolean {
  return a === b || sameChildren(parse(a), parse(b))
}

function parse(html: string): Node {
  const document = createDocument("")
  document.body.innerHTML = html
  return document.body
}

// domino node lists are array-likes without an iterator.
function sameChildren(a: Node, b: Node): boolean {
  const [left, right] = [a.childNodes, b.childNodes]
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index++) {
    if (!sameNode(left[index]!, right[index]!)) return false
  }
  return true
}

function sameNode(a: Node, b: Node): boolean {
  if (a.nodeType !== b.nodeType) return false
  if (a.nodeType !== a.ELEMENT_NODE) return a.nodeValue === b.nodeValue
  const [left, right] = [a as Element, b as Element]
  if (left.localName !== right.localName || left.attributes.length !== right.attributes.length) return false
  for (let index = 0; index < left.attributes.length; index++) {
    const attribute = left.attributes[index]!
    if (right.getAttribute(attribute.name) !== attribute.value) return false
  }
  return sameChildren(left, right)
}
