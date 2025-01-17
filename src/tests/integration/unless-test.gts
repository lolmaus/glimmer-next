import { module, test } from 'qunit';
import { render } from '@lfieart/gxt/test-utils';

module('Integration | InternalComponent | unless', function () {
  test('renders false branch if arg is false and only false branch exists', async function (assert) {
    const value = false;
    await render(
      <template>
        {{#unless value}}
          <div data-test-false-branch></div>
        {{/unless}}
      </template>,
    );
    assert.dom('[data-test-false-branch]').exists('only false branch exists');
  });
  test('renders false branch if arg is false', async function (assert) {
    const value = false;
    await render(
      <template>
        {{#unless value}}
          <div data-test-false-branch></div>
        {{else}}
          <div data-test-true-branch></div>
        {{/unless}}
      </template>,
    );
    assert
      .dom('[data-test-false-branch]')
      .exists('false branch exists for initial false value');
    assert
      .dom('[data-test-true-branch]')
      .doesNotExist('true branch does not exist for initial true value');
  });
});
