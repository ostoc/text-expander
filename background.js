const api = typeof browser !== 'undefined' ? browser : chrome;

api.action.onClicked.addListener(() => {
  api.runtime.openOptionsPage();
});