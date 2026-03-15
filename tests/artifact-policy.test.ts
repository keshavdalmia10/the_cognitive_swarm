import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFallbackArtifact, getDiagramLabel, inferDiagramType, prioritizeArtifactIdeas } from '../src/utils/artifactPolicy.ts';

test('inferDiagramType picks ER diagrams for database topics', () => {
  assert.equal(
    inferDiagramType('Design a relational database schema for a university system'),
    'erDiagram',
  );
});

test('inferDiagramType picks flowcharts for workflow topics', () => {
  assert.equal(
    inferDiagramType('Map the onboarding workflow for new students'),
    'flowchart',
  );
});

test('inferDiagramType picks class diagrams for OOP topics', () => {
  assert.equal(
    inferDiagramType('Create an object model for controllers, services, and repositories'),
    'classDiagram',
  );
});

test('inferDiagramType picks mind maps for concept-heavy brainstorming topics', () => {
  assert.equal(
    inferDiagramType('Brainstorm strategy themes for a climate action campaign'),
    'mindmap',
  );
});

test('getDiagramLabel returns human-readable labels', () => {
  assert.equal(getDiagramLabel('erDiagram'), 'ER Diagram');
  assert.equal(getDiagramLabel('journey'), 'Journey Map');
});

test('prioritizeArtifactIdeas ranks by descending weight', () => {
  const prioritized = prioritizeArtifactIdeas([
    { text: 'Low', weight: 1 },
    { text: 'High', weight: 5 },
    { text: 'Mid', weight: 3 },
  ]);

  assert.deepEqual(prioritized.map((idea) => idea.text), ['High', 'Mid', 'Low']);
});

test('buildFallbackArtifact creates an ER diagram for database topics', () => {
  const artifact = buildFallbackArtifact('Database schema for a school', [
    { cluster: 'Students', text: 'Student profile and enrollment records' },
    { cluster: 'Courses', text: 'Course catalog and prerequisites' },
  ]);

  assert.equal(artifact.diagramType, 'erDiagram');
  assert.match(artifact.mermaid, /^erDiagram/);
  assert.match(artifact.mermaid, /STUDENTS/);
  assert.match(artifact.mermaid, /COURSES/);
});

test('buildFallbackArtifact creates a journey map when explicitly requested', () => {
  const artifact = buildFallbackArtifact(
    'Student classroom experience',
    [
      { text: 'Arrive in class' },
      { text: 'Submit an idea' },
      { text: 'Respond to peer critique' },
    ],
    'journey',
  );

  assert.equal(artifact.diagramType, 'journey');
  assert.match(artifact.mermaid, /^journey/);
  assert.match(artifact.mermaid, /Arrive in class/);
});
