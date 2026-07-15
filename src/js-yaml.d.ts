declare module "js-yaml" {
  export function load(content: string): unknown;
  export function loadAll(content: string): unknown[];
}
