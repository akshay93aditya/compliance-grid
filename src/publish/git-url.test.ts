import { describe, expect, it } from 'vitest';
import {
  parseOwnerRepo,
  parseRepoFromGitUrl,
  resolveGhPrTarget,
} from './git-url';

describe('parseRepoFromGitUrl', () => {
  it('parses ssh remote', () => {
    expect(
      parseRepoFromGitUrl('git@github.com:akshay93aditya/compliance-grid-data.git')
    ).toEqual({ owner: 'akshay93aditya', name: 'compliance-grid-data' });
  });

  it('parses ssh remote without .git suffix', () => {
    expect(
      parseRepoFromGitUrl('git@github.com:akshay93aditya/compliance-grid-data')
    ).toEqual({ owner: 'akshay93aditya', name: 'compliance-grid-data' });
  });

  it('parses https remote', () => {
    expect(
      parseRepoFromGitUrl('https://github.com/akshay93aditya/compliance-grid-data.git')
    ).toEqual({ owner: 'akshay93aditya', name: 'compliance-grid-data' });
  });

  it('parses https remote without .git suffix', () => {
    expect(
      parseRepoFromGitUrl('https://github.com/akshay93aditya/compliance-grid-data')
    ).toEqual({ owner: 'akshay93aditya', name: 'compliance-grid-data' });
  });

  it('parses ssh:// scheme', () => {
    expect(
      parseRepoFromGitUrl('ssh://git@github.com/akshay93aditya/compliance-grid-data.git')
    ).toEqual({ owner: 'akshay93aditya', name: 'compliance-grid-data' });
  });

  it('throws on non-github URL', () => {
    expect(() => parseRepoFromGitUrl('https://gitlab.com/x/y.git')).toThrow();
  });

  it('throws on garbage', () => {
    expect(() => parseRepoFromGitUrl('not-a-url')).toThrow();
  });
});

describe('parseOwnerRepo', () => {
  it('parses owner/name', () => {
    expect(parseOwnerRepo('akshay93aditya/compliance-grid-data')).toEqual({
      owner: 'akshay93aditya',
      name: 'compliance-grid-data',
    });
  });

  it('throws on missing slash', () => {
    expect(() => parseOwnerRepo('akshay93aditya')).toThrow();
  });

  it('throws on extra path segment', () => {
    expect(() => parseOwnerRepo('a/b/c')).toThrow();
  });
});

describe('resolveGhPrTarget', () => {
  it('same-repo flow when no upstream specified (canonical maintainer)', () => {
    const target = resolveGhPrTarget({
      remote: 'git@github.com:akshay93aditya/compliance-grid-data.git',
      branch: 'publish/akshay93aditya/2026-06-08-12-mqzz',
    });
    expect(target).toEqual({
      repo: 'akshay93aditya/compliance-grid-data',
      head: 'publish/akshay93aditya/2026-06-08-12-mqzz',
    });
  });

  it('same-repo flow when upstream matches remote exactly', () => {
    const target = resolveGhPrTarget({
      remote: 'git@github.com:akshay93aditya/compliance-grid-data.git',
      upstream: 'akshay93aditya/compliance-grid-data',
      branch: 'publish/akshay93aditya/2026-06-08-12-mqzz',
    });
    expect(target.head).toBe('publish/akshay93aditya/2026-06-08-12-mqzz');
    expect(target.repo).toBe('akshay93aditya/compliance-grid-data');
  });

  it('cross-fork flow when upstream differs (external contributor)', () => {
    const target = resolveGhPrTarget({
      remote: 'git@github.com:alice/compliance-grid-data.git',
      upstream: 'akshay93aditya/compliance-grid-data',
      branch: 'publish/alice/2026-06-08-12-3',
    });
    expect(target).toEqual({
      repo: 'akshay93aditya/compliance-grid-data',
      head: 'alice:publish/alice/2026-06-08-12-3',
    });
  });

  it('throws when fork repo name does not match upstream', () => {
    expect(() =>
      resolveGhPrTarget({
        remote: 'git@github.com:alice/compliance-grid-data-fork.git',
        upstream: 'akshay93aditya/compliance-grid-data',
        branch: 'b',
      })
    ).toThrow(/does not match/);
  });

  it('handles https remote in cross-fork mode', () => {
    const target = resolveGhPrTarget({
      remote: 'https://github.com/alice/compliance-grid-data.git',
      upstream: 'akshay93aditya/compliance-grid-data',
      branch: 'b',
    });
    expect(target.head).toBe('alice:b');
  });
});
