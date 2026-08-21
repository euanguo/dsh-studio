import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import vm from 'node:vm'

function jsx(type, props) {
  return { type, props: props ?? {} }
}

function jsxs(type, props) {
  return { type, props: props ?? {} }
}

function valueOf(initial) {
  return typeof initial === 'function' ? initial() : initial
}

function findElements(node, predicate, result = []) {
  if (node === null || typeof node !== 'object') return result
  if (predicate(node)) result.push(node)
  const props = node.props
  if (props === null || typeof props !== 'object') return result
  const children = props.children
  if (Array.isArray(children)) {
    for (const child of children) findElements(child, predicate, result)
  } else {
    findElements(children, predicate, result)
  }
  return result
}

function loadAppFrame(clientPath) {
  const source = readFileSync(clientPath, 'utf8')
  let moduleEntry
  const windowObject = {
    innerWidth: 0,
    __ModuleLoader__: {
      load(entry) { moduleEntry = entry },
    },
  }
  const context = {
    console,
    window: windowObject,
  }
  vm.runInNewContext(source, context, { filename: clientPath })
  if (moduleEntry === undefined) throw new Error('staged ui-layout bundle did not register with ModuleLoader')
  let registration
  const fakeReact = {
    useCallback: callback => callback,
    useEffect: () => {},
    useLayoutEffect: () => {},
    useRef: initial => ({ current: initial }),
    useState: initial => [valueOf(initial), () => {}],
  }
  const exports = moduleEntry.factory((id) => {
    if (id === 'react/jsx-runtime') return { Fragment: Symbol('Fragment'), jsx, jsxs }
    if (id === 'react') return fakeReact
    if (id === '@deepseek-ai/dsh-client-runtime/client') {
      return { defineStore: spec => spec }
    }
    throw new Error(`unexpected ui-layout dependency: ${id}`)
  })
  let effectCount = 0
  const ctx = {
    effect(effect) {
      effectCount += 1
      return effectCount === 1 ? effect() : () => {}
    },
    reflect: { provide() { return () => {} } },
    slots: {
      register(options, component) {
        if (options.name === 'root') registration = component
        return () => {}
      },
    },
  }
  exports.apply(ctx)
  if (registration === undefined) throw new Error('staged ui-layout did not register AppFrame')
  return { registration, windowObject }
}

function renderFrame(registration, windowObject, viewport, state) {
  windowObject.innerWidth = viewport
  const actions = {
    closeDetailsCalls: 0,
    sidebar: [],
    details: [],
    closeDetails() { this.closeDetailsCalls += 1 },
    setSidebar(width) { this.sidebar.push(width) },
    setDetails(width) { this.details.push(width) },
  }
  const rendered = registration({
    actions,
    renderSlot: (name, owner) => ({ name, owner }),
    useSessions: selector => selector(state.sessions),
    useStore: selector => selector(state.panels),
  })
  return { actions, rendered }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, received ${String(actual)}`)
}

/** Verify the staged AppFrame's real compiled interaction behavior. */
export function verifyStagedLayout(runtimeRoot) {
  const clientPath = join(
    runtimeRoot,
    'node_modules',
    '@deepseek-ai',
    'dsh-client-ui-layout',
    'lib',
    'client.js',
  )
  if (!existsSync(clientPath)) throw new Error(`staged ui-layout bundle is missing: ${clientPath}`)
  const { registration, windowObject } = loadAppFrame(clientPath)

  const wide = renderFrame(registration, windowObject, 1500, {
    panels: { sidebar: 300, details: 360 },
    sessions: { current: 'session', byId: { session: { blank: false } } },
  })
  assertEqual(
    wide.rendered.props.style.gridTemplateColumns,
    '300px minmax(0px, 1fr) 360px',
    'wide grid has no center floor',
  )
  const wideHandles = findElements(wide.rendered, node => typeof node.type === 'function' && node.type.name === 'DragHandle')
  const leftHandle = wideHandles.find(node => node.props.side === 'sidebar')
  const detailsHandle = wideHandles.find(node => node.props.side === 'details')
  if (leftHandle === undefined || detailsHandle === undefined) throw new Error('staged ui-layout drag handles are missing')
  leftHandle.props.onStart()
  leftHandle.props.onDrag(500)
  assertEqual(wide.actions.sidebar.at(-1), 400, 'left drag clamps only the left side')
  assertEqual(wide.actions.details.length, 0, 'left drag leaves details width unchanged')
  detailsHandle.props.onStart()
  detailsHandle.props.onDrag(-500)
  assertEqual(wide.actions.details.at(-1), 640, 'details drag clamps only the right side')
  assertEqual(wide.actions.sidebar.length, 1, 'details drag leaves sidebar width unchanged')

  const tight = renderFrame(registration, windowObject, 1200, {
    panels: { sidebar: 400, details: 640 },
    sessions: { current: 'session', byId: { session: { blank: false } } },
  })
  assertEqual(
    tight.rendered.props.style.gridTemplateColumns,
    '400px minmax(0px, 1fr) 640px',
    'both side panels fit the smallest window with zero center',
  )

  const narrow = renderFrame(registration, windowObject, 900, {
    panels: { sidebar: 300, details: 0 },
    sessions: { current: undefined, byId: {} },
  })
  assertEqual(
    narrow.rendered.props.style.gridTemplateColumns,
    '300px minmax(0px, 1fr) 0px',
    'narrow viewport keeps the left rail expanded',
  )
  const sidebarOwner = narrow.rendered.props.children[0].props.children
  assertEqual(sidebarOwner.owner.collapsed, false, 'narrow viewport does not auto-collapse the left rail')
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runtimeRoot = process.argv[2]
  if (runtimeRoot === undefined) throw new Error('usage: node scripts/verify-staged-layout.mjs <runtime-root>')
  verifyStagedLayout(resolve(runtimeRoot))
  console.log(`Verified staged DSH layout interactions: ${resolve(runtimeRoot)}`)
}
