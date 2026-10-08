import assert from 'node:assert/strict';
import test from 'node:test';
import 'global-jsdom/register';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { Input } from './input.jsx';
import { Label } from './label.jsx';
import { Textarea } from './textarea.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select.jsx';

test.afterEach(() => cleanup());

test('an Input next to a Label with no htmlFor still has that label as its accessible name', () => {
  render(React.createElement('div', null, React.createElement(Label, null, 'Lot number'), React.createElement(Input, { defaultValue: 'LOT-01' })));
  assert.ok(screen.getByRole('textbox', { name: 'Lot number' }));
});

test('a Textarea gets the same treatment, and an explicit aria-label is never overridden', () => {
  render(React.createElement('div', null,
    React.createElement(Label, null, 'Notes'), React.createElement(Textarea, null),
    React.createElement(Label, null, 'Other'), React.createElement(Input, { 'aria-label': 'Explicit name' })));
  assert.ok(screen.getByRole('textbox', { name: 'Notes' }));
  assert.ok(screen.getByRole('textbox', { name: 'Explicit name' }));
  assert.equal(screen.queryByRole('textbox', { name: 'Other' }), null);
});

test('an Input that is properly associated (htmlFor/id) keeps that association untouched', () => {
  render(React.createElement('div', null, React.createElement('label', { htmlFor: 'a' }, 'Proper'), React.createElement(Input, { id: 'a' })));
  const input = screen.getByRole('textbox', { name: 'Proper' });
  assert.equal(input.getAttribute('aria-label'), null);
});

test('a Select trigger takes the label next to it, never one from a wider container', () => {
  render(React.createElement('div', null,
    React.createElement(Label, null, 'Search purchase orders'),
    React.createElement('div', null,
      React.createElement('div', null,
        React.createElement(Label, null, 'Supplier'),
        React.createElement(Select, null, React.createElement(SelectTrigger, null, React.createElement(SelectValue, { placeholder: 'Choose' })), React.createElement(SelectContent, null, React.createElement(SelectItem, { value: 'a' }, 'A')))),
      React.createElement(Select, null, React.createElement(SelectTrigger, null, React.createElement(SelectValue, { placeholder: 'Location' })), React.createElement(SelectContent, null, React.createElement(SelectItem, { value: 'b' }, 'B'))))));
  assert.ok(screen.getByRole('combobox', { name: 'Supplier' }), 'named by the directly adjacent label');
  assert.ok(screen.getByRole('combobox', { name: 'Location' }), 'with no adjacent label it falls back to its placeholder, not to a distant label');
});

test('a Select trigger whose label mounts after it still gets named (observer, not a one-off check)', async () => {
  const { container } = render(React.createElement('div', { 'data-testid': 'group' },
    React.createElement(Select, null, React.createElement(SelectTrigger, null, React.createElement(SelectValue, null)), React.createElement(SelectContent, null, React.createElement(SelectItem, { value: 'a' }, 'A')))));
  const group = container.querySelector('[data-testid="group"]');
  // Nothing to name it from yet: no label, no placeholder, no value.
  assert.equal(screen.getByRole('combobox').getAttribute('aria-label'), null);
  const label = document.createElement('label');
  label.textContent = 'Late label';
  group.insertBefore(label, group.firstChild);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(screen.getByRole('combobox', { name: 'Late label' }));
});
