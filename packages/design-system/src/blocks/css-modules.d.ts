// CSS module imports used by the block components; the app bundler resolves them.
declare module '*.module.scss' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
