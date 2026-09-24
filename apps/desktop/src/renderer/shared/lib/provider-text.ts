/** An inert template never mounts provider markup or resources into the page.
 * Only its text is returned; scripts, styling, media and link behavior are discarded. */
export function providerText(value: string | null | undefined) {
  if (!value) return undefined
  const template = document.createElement("template")
  template.innerHTML = value
  template.content
    .querySelectorAll("script,style,iframe,object,embed,img,video,audio,source")
    .forEach((node) => node.remove())
  template.content
    .querySelectorAll("p,div,li,h1,h2,h3,h4,br")
    .forEach((node) => node.before(document.createTextNode("\n")))
  return template.content.textContent?.trim() || undefined
}
