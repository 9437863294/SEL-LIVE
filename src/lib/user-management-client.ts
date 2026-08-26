'use client';

import { auth } from './firebase';
import type { User } from './types';

export interface CreatePlatformUserInput {
  name: string;
  email: string;
  password: string;
  mobile?: string;
  baseRole: string;
  status?: 'Active' | 'Inactive';
  employeeId?: string;
  employeeNo?: string;
  additionalRoleIds?: string[];
  departmentIds?: string[];
  designations?: string[];
  projectIds?: string[];
  reportingManagerId?: string;
  location?: string;
  createAccessGrant?: boolean;
}

async function token(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Your session has expired. Please sign in again.');
  return user.getIdToken();
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  const data = (await response.json().catch(() => ({}))) as { error?: unknown };
  return new Error(typeof data.error === 'string' ? data.error : fallback);
}

/** Create the Auth identity, Firestore profile and optional access grant through the protected API. */
export async function createPlatformUser(
  input: CreatePlatformUserInput,
): Promise<{ user: User; welcomeEmailSent: boolean }> {
  const idToken = await token();
  const response = await fetch('/api/create-user', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await responseError(response, 'The user could not be created.');

  const data = (await response.json()) as { user: User };

  // Account creation is the durable action. Email delivery is reported separately and never rolls
  // the account back, so an SMTP outage cannot create an Auth/profile mismatch.
  let welcomeEmailSent = false;
  try {
    const welcome = await fetch('/api/send-welcome-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        name: input.name,
        email: input.email,
        password: input.password,
        role: input.baseRole,
      }),
    });
    welcomeEmailSent = welcome.ok;
  } catch {
    welcomeEmailSent = false;
  }

  return { user: data.user, welcomeEmailSent };
}
