export interface ProjectReviewState<T> { project: T | null; candidate: T | null; }
export type ProjectReviewAction<T> =
  | { type: 'connect'; review: T | null }
  | { type: 'candidate'; review: T }
  | { type: 'dismiss-candidate' }
  | { type: 'update-active'; update: (review: T) => T }
  | { type: 'update-project'; update: (review: T) => T };

/** A preview must never replace the original XML attached to the current score. */
export function projectReviewReducer<T>(state: ProjectReviewState<T>, action: ProjectReviewAction<T>): ProjectReviewState<T> {
  switch (action.type) {
    case 'connect': return { project: action.review, candidate: null };
    case 'candidate': return { ...state, candidate: action.review };
    case 'dismiss-candidate': return state.candidate ? { ...state, candidate: null } : state;
    case 'update-project': return state.project ? { ...state, project: action.update(state.project) } : state;
    case 'update-active':
      if (state.candidate) return { ...state, candidate: action.update(state.candidate) };
      return state.project ? { ...state, project: action.update(state.project) } : state;
  }
}
