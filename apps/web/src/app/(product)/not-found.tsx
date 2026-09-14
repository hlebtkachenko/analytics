import Link from 'next/link';

import PageContainer from '../../components/page-container';

export default function ProductNotFound() {
  return (
    <PageContainer>
      <h1>Page not found</h1>
      <p>The page you are looking for does not exist.</p>
      <Link href="/">Return home</Link>
    </PageContainer>
  );
}
