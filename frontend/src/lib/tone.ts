/** A stable hue for a piece of text, so the same title or name always gets the same colour. */
export function hue(text: string) {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360
  return h
}

/** The gradient a book without a cover image gets; also used as its ambient colour. */
export function placeholderGradient(title: string) {
  return `linear-gradient(160deg, hsl(${hue(title)} 45% 42%), hsl(${(hue(title) + 40) % 360} 50% 28%))`
}
