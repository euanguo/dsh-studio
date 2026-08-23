import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  basename,
  dirname,
  isUnderRoot,
  joinPath,
  normalizePath,
  relativePathOf,
  resolveCapabilitiesPath,
} from '../plugins/shared/path.ts'

test('normalizePath: separators, repeats and trailing slashes', () => {
  assert.equal(normalizePath('a\\b\\c'), 'a/b/c')
  assert.equal(normalizePath('/a//b/'), '/a/b')
  assert.equal(normalizePath('a/'), 'a')
  assert.equal(normalizePath(''), '')
  assert.equal(normalizePath('C:\\code\\x'), 'C:/code/x')
})

test('basename: last segment with mixed separators and edge inputs', () => {
  assert.equal(basename('a/b/c.ts'), 'c.ts')
  assert.equal(basename('a\\b\\c.ts'), 'c.ts')
  assert.equal(basename('/a/b/'), 'b')
  assert.equal(basename('plain.ts'), 'plain.ts')
  assert.equal(basename(''), '')
  assert.equal(basename('/'), '/')
})

test('dirname: parent directory with bare-name and root edges', () => {
  assert.equal(dirname('a/b/c.ts'), 'a/b')
  assert.equal(dirname('a/b'), 'a')
  assert.equal(dirname('a'), '')
  assert.equal(dirname('a/b/'), 'a')
  assert.equal(dirname('/a'), '/')
  assert.equal(dirname(''), '')
})

test('joinPath: normalizes the joined result', () => {
  assert.equal(joinPath('/root/', 'src'), '/root/src')
  assert.equal(joinPath('src', 'a//b'), 'src/a/b')
  assert.equal(joinPath('a', 'b', 'c'), 'a/b/c')
})

test('isUnderRoot: containment with prefix boundary', () => {
  assert.equal(isUnderRoot('/a', '/a'), true)
  assert.equal(isUnderRoot('/a', '/a/b/c'), true)
  assert.equal(isUnderRoot('/a/', '/a/b'), true)
  assert.equal(isUnderRoot('/a', '/ab'), false)
  assert.equal(isUnderRoot('/a', '/b'), false)
})

test('resolveCapabilitiesPath: cwd-relative wire path to absolute', () => {
  assert.equal(resolveCapabilitiesPath('/repo', 'src/a.ts'), '/repo/src/a.ts')
  assert.equal(resolveCapabilitiesPath('/repo/', 'src/a.ts'), '/repo/src/a.ts')
  assert.equal(resolveCapabilitiesPath('/repo', ''), '/repo')
  assert.equal(resolveCapabilitiesPath('/repo', '\\src\\a.ts'), '/repo/src/a.ts')
})

test('relativePathOf: absolute to cwd-relative, outside-cwd fallback', () => {
  assert.equal(relativePathOf('/repo', '/repo/src/a.ts'), 'src/a.ts')
  assert.equal(relativePathOf('/repo', '/repo'), '')
  assert.equal(relativePathOf('/repo', '/other/x.ts'), 'other/x.ts')
  assert.equal(relativePathOf('/repo', '/repo/src/'), 'src')
})
