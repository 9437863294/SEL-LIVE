import { redirect } from 'next/navigation';

/** Items are added from the register's Add Item dialog, as in Project Management. */
export default function Page() {
  redirect('/master-drawing-list/register?add=1');
}
