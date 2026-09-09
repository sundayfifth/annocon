/**
 * Reading a page scan — against the one before it, and against one
 * connector's two endpoints.
 *
 * The scene layer is what walks the page and measures boxes; what counts as
 * *different* between two of those walks, and which of those boxes a given
 * route has to care about, are decisions. They belong here where they can be
 * tested without a document to walk.
 */

import type { ConnectorGeometry } from './connector.js'
import {
  type RouteObstacles,
  ROUTE_SEARCH_MARGIN,
  obstaclesInPlay
} from './routeCost.js'
import type { Rect } from './anchor.js'
import { sameRect } from './anchor.js'

/** A box an elbow route should bend around, tagged with the node it came from so an endpoint's own screen can be told apart. */
export interface RouteObstacle {
  readonly id: string
  readonly rect: Rect
}

/** No boxes to route around — what a line that is not asked to avoid anything gets. */
export const EMPTY_OBSTACLES: RouteObstacles = { foreign: [], own: [] }

/**
 * Sorts the page's boxes into the two kinds `RouteObstacles` distinguishes,
 * and drops the ones too far away to matter.
 *
 * The endpoints' own frames used to be dropped entirely, on the grounds that
 * a connector cannot avoid the screens it is attached to. True of the
 * segments that leave and arrive, and false of everything in between — a
 * route that leaves a screen by its nearest edge is otherwise free to turn
 * straight back through the middle of that same screen, which is exactly the
 * shape `resolveMagnetEscapingFrame` was added to stop producing.
 *
 * `startOwnerId`/`endOwnerId` are the top-level nodes the two endpoints live
 * under — which entry in the scan each one *is*, so its own screen can be
 * sorted into `own` rather than treated as a stranger.
 */
export function splitRouteObstacles(
  all: ReadonlyArray<RouteObstacle>,
  geometry: ConnectorGeometry,
  startOwnerId: string | null,
  endOwnerId: string | null
): RouteObstacles {
  const start = geometry.start
  const end = geometry.end
  if (start === null || end === null) return EMPTY_OBSTACLES
  const ownIds = new Set(
    [startOwnerId, endOwnerId].filter((id): id is string => id !== null)
  )
  const near = obstaclesInPlay(
    all.map((obstacle) => obstacle.rect),
    start,
    end,
    ROUTE_SEARCH_MARGIN
  )
  const nearRects = new Set(near)
  const foreign: Array<Rect> = []
  const own: Array<Rect> = []
  for (const obstacle of all) {
    if (!nearRects.has(obstacle.rect)) continue
    if (ownIds.has(obstacle.id)) own.push(obstacle.rect)
    else foreign.push(obstacle.rect)
  }
  return { foreign, own }
}

/**
 * Every rectangle that has to be re-examined because one scan differs from
 * the one before it: boxes that moved or resized (both the space they left
 * and the space they took), boxes that appeared, and boxes that are no
 * longer there.
 *
 * All three cases are the same question asked of the route — is anything
 * different where this line passes — and only the first of them is a *move*.
 * A screen can stop being in the way by being deleted, by being hidden, or
 * by being dragged out of the page entirely, and none of those change a
 * rectangle: the box simply stops being in the list. Reading the difference
 * between two scans catches every one of them without the caller having to
 * know which happened, or a `nodechange` having to describe it.
 *
 * `before` is the older of the two. A deletion is only visible from that
 * side — the node is already gone by the time the change arrives, so `now`
 * has nothing to report and a `RemovedNode` carries no bounding box to ask.
 */
export function boxesChangedBetweenScans(
  before: ReadonlyMap<string, Rect>,
  now: ReadonlyMap<string, Rect>
): ReadonlyArray<Rect> {
  const changed: Array<Rect> = []
  for (const [id, rect] of now) {
    const was = before.get(id)
    if (typeof was === 'undefined') {
      changed.push(rect)
      continue
    }
    // Both rectangles: a move invalidates the lines it has just left alone
    // as well as the ones it has just landed on.
    if (!sameRect(was, rect)) changed.push(was, rect)
  }
  for (const [id, rect] of before) {
    if (!now.has(id)) changed.push(rect)
  }
  return changed
}
