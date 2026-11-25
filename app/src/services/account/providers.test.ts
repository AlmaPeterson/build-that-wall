// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { GoogleSignIn } from './google';
import { OtherSignIn, githubReturn, withoutGithubQuery } from './providers';
import { SERVER, fakeApi, makeStore } from './test-fakes';
import { accountId, getUser, verifiedUser } from './user';

const reply = { token: 'BTWS.x.y', id: 'pw:sam', name: 'sam', email: '', exp: 4102444800 };

function setup(replies: Record<string, unknown>) {
  const { store } = makeStore();
  const { api, calls } = fakeApi(replies, '');
  return { store, calls, others: new OtherSignIn(store, (path, body) => api.call(SERVER, path, body)) };
}

describe('OtherSignIn', () => {
  it('signs in with a username and password and keeps the server token', async () => {
    const { store, calls, others } = setup({ '/auth/password-login': reply });
    store.set('acct:g:pw:sam', JSON.stringify({ color: 'blue' }));
    expect(await others.password('login', ' sam ', 'secret123')).toEqual({ name: 'sam' });
    expect(calls[0]!.body).toMatchObject({ username: 'sam', password: 'secret123' });
    expect(verifiedUser(store)?.token).toBe('BTWS.x.y');
    expect(accountId(store)).toBe('g:pw:sam');
    expect(store.get('color')).toBe('blue');
  });

  it('makes a new account only with the code emailed to the player', async () => {
    const { calls, others } = setup({ '/auth/register-code': { sent: true }, '/auth/password-register': reply });
    expect(await others.sendCode(' sam ', 'secret123', ' sam@example.com ')).toEqual({ sent: true });
    expect(calls[0]!.url).toContain('path=auth%2Fregister-code');
    expect(calls[0]!.body).toMatchObject({ username: 'sam', password: 'secret123', email: 'sam@example.com' });
    expect(await others.password('register', 'sam', 'secret123', ' 123456 ')).toEqual({ name: 'sam' });
    expect(calls[1]!.url).toContain('path=auth%2Fpassword-register');
    expect(calls[1]!.body).toMatchObject({ username: 'sam', password: 'secret123', code: '123456' });
  });

  it('says why a code could not be sent', async () => {
    const { others } = setup({ '/auth/register-code': { error: 'emailused' } });
    expect(await others.sendCode('sam', 'secret123', 'sam@example.com')).toEqual({ error: 'emailused' });
  });

  it("passes on the server's errors and says when it can't be reached", async () => {
    const { store, others } = setup({ '/auth/password-login': { error: 'wrong' } });
    expect(await others.password('login', 'sam', 'nope')).toEqual({ error: 'wrong' });
    expect(await others.password('register', 'sam', 'nope')).toEqual({ error: 'offline' });
    expect(getUser(store)).toBeNull();
  });

  it('only finishes a GitHub sign-in that this page started', async () => {
    const { calls, others } = setup({ '/auth/github': { ...reply, id: 'github:7', name: 'Octo Cat' } });
    sessionStorage.setItem('btw-gh-state', 'btwghabc');
    expect(await others.githubReturned('code1', 'btwghother')).toEqual({ error: 'login' });
    sessionStorage.setItem('btw-gh-state', 'btwghabc');
    expect(await others.githubReturned('code1', 'btwghabc')).toEqual({ name: 'Octo Cat' });
    expect(calls[0]!.body).toMatchObject({ code: 'code1' });
    expect(await others.githubReturned('code1', 'btwghabc')).toEqual({ error: 'login' });   // used once only
  });
});

describe('GitHub coming back', () => {
  it("reads GitHub's code, but not other ?code= links", () => {
    expect(githubReturn('?code=abc&state=btwgh123')).toEqual({ code: 'abc', state: 'btwgh123' });
    expect(githubReturn('?code=abc&state=other')).toBeNull();
    expect(githubReturn('?demo')).toBeNull();
  });

  it('takes the code out of the address', () => {
    expect(withoutGithubQuery('https://x.com/game/?code=abc&state=btwgh1&demo=1')).toBe('https://x.com/game/?demo=1');
  });
});

describe('the sign-in box', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('offers a username and password without Google, and shows why it failed', async () => {
    const { store } = makeStore();
    const tries: string[] = [];
    const done = new GoogleSignIn(store).signIn('', {
      password: async (mode, user, pass) => { tries.push(`${mode} ${user} ${pass}`); return pass === 'right' ? { name: user } : { error: 'wrong' }; },
    });
    const inputs = [...document.querySelectorAll('input')].filter(i => i.style.display !== 'none');
    expect(inputs).toHaveLength(2);
    inputs[0]!.value = 'sam'; inputs[1]!.value = 'bad';
    document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise(r => setTimeout(r, 0));
    expect(document.querySelector('[role=alert]')!.textContent).toBe('Wrong username or password.');
    inputs[1]!.value = 'right';
    [...document.querySelectorAll('button')].find(b => b.textContent === 'Create account')!.click();
    expect(await done).toBe('sam');
    expect(tries).toEqual(['login sam bad', 'register sam right']);
    expect(document.querySelector('form')).toBeNull();
  });

  it('a new account asks for an email, emails a code, and is made only with that code', async () => {
    const { store } = makeStore();
    const sent: string[] = [], tries: string[] = [];
    const done = new GoogleSignIn(store).signIn('', {
      password: async (mode, user, pass, code) => { tries.push(`${mode} ${user} ${pass} ${code}`); return code === '123456' ? { name: user } : { error: 'code' }; },
      sendCode: async (user, _pass, email) => { sent.push(`${user} ${email}`); return { sent: true }; },
    });
    const byLabel = (l: string) => document.querySelector(`input[aria-label="${l}"]`) as HTMLInputElement;
    const button = (t: string) => [...document.querySelectorAll('button')].find(b => b.textContent === t)!;
    byLabel('Username').value = 'sam'; byLabel('Password').value = 'secret123';
    expect(byLabel('Your email').style.display).toBe('none');
    button('Create account').click();                                  // asks for the email
    expect(byLabel('Your email').style.display).toBe('');
    byLabel('Your email').value = 'sam@example.com';
    button('Email me a code').click();
    await new Promise(r => setTimeout(r, 0));
    expect(sent).toEqual(['sam sam@example.com']);
    expect(byLabel('6-digit code').style.display).toBe('');
    expect(document.body.textContent).toContain('We sent a 6-digit code to sam@example.com');
    byLabel('6-digit code').value = '000000';
    button('Create account').click();
    await new Promise(r => setTimeout(r, 0));
    expect(document.querySelector('[role=alert]')!.textContent).toBe("That code isn't right. Check the email and try again.");
    byLabel('6-digit code').value = '123456';
    button('Create account').click();
    expect(await done).toBe('sam');
    expect(tries).toEqual(['register sam secret123 000000', 'register sam secret123 123456']);
  });

  it('shows Apple and GitHub when the game has them', async () => {
    const { store } = makeStore();
    const done = new GoogleSignIn(store).signIn('', { apple: async () => ({ name: 'Ann' }), github: async () => ({ name: 'Gus' }) });
    const labels = [...document.querySelectorAll('button')].map(b => b.textContent);
    expect(labels).toEqual(['Sign in with Apple', 'Sign in with GitHub', 'Cancel']);
    [...document.querySelectorAll('button')][1]!.click();
    expect(await done).toBe('Gus');
  });

  it('has nothing to show without any way to sign in', async () => {
    expect(await new GoogleSignIn(makeStore().store).signIn('', {})).toBe('nosetup');
  });
});
