import Link from 'next/link';

export default function NotFound() {
  return (
    <main id="main-content" tabIndex={-1}>
      <h1>Page not found</h1>
      <Link href="/">Go to the start page</Link>
    </main>
  );
}
