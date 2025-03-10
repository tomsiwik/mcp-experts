import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

// Define memory file path using environment variable with fallback
const defaultMemoryPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "memory.json"
);

// If MEMORY_FILE_PATH is just a filename, put it in the same directory as the script
const MEMORY_FILE_PATH = process.env.MEMORY_FILE_PATH
  ? path.isAbsolute(process.env.MEMORY_FILE_PATH)
    ? process.env.MEMORY_FILE_PATH
    : path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        process.env.MEMORY_FILE_PATH
      )
  : defaultMemoryPath;

// Zod schemas for validation
export const EntitySchema = z.object({
  name: z.string(),
  entityType: z.string(),
  observations: z.array(z.string()),
});

export const RelationSchema = z.object({
  from: z.string(),
  to: z.string(),
  relationType: z.string(),
});

export const KnowledgeGraphSchema = z.object({
  entities: z.array(EntitySchema),
  relations: z.array(RelationSchema),
});

// Types inferred from the schemas
export type Entity = z.infer<typeof EntitySchema>;
export type Relation = z.infer<typeof RelationSchema>;
export type KnowledgeGraph = z.infer<typeof KnowledgeGraphSchema>;

// The KnowledgeGraphManager class contains all operations to interact with the knowledge graph
export class KnowledgeGraphManager {
  // Public methods - only for reading

  /**
   * Read the entire knowledge graph
   */
  async readGraph(): Promise<KnowledgeGraph> {
    return this.loadGraph();
  }

  /**
   * Search for nodes in the knowledge graph based on a query
   */
  async searchNodes(query: string): Promise<KnowledgeGraph> {
    const graph = await this.loadGraph();

    // Filter entities
    const filteredEntities = graph.entities.filter(
      (e) =>
        e.name.toLowerCase().includes(query.toLowerCase()) ||
        e.entityType.toLowerCase().includes(query.toLowerCase()) ||
        e.observations.some((o) =>
          o.toLowerCase().includes(query.toLowerCase())
        )
    );

    // Create a Set of filtered entity names for quick lookup
    const filteredEntityNames = new Set(filteredEntities.map((e) => e.name));

    // Filter relations to only include those between filtered entities
    const filteredRelations = graph.relations.filter(
      (r) => filteredEntityNames.has(r.from) && filteredEntityNames.has(r.to)
    );

    const filteredGraph: KnowledgeGraph = {
      entities: filteredEntities,
      relations: filteredRelations,
    };

    return filteredGraph;
  }

  /**
   * Open specific nodes in the knowledge graph by their names
   */
  async openNodes(names: string[]): Promise<KnowledgeGraph> {
    const graph = await this.loadGraph();

    // Filter entities
    const filteredEntities = graph.entities.filter((e) =>
      names.includes(e.name)
    );

    // Create a Set of filtered entity names for quick lookup
    const filteredEntityNames = new Set(filteredEntities.map((e) => e.name));

    // Filter relations to only include those between filtered entities
    const filteredRelations = graph.relations.filter(
      (r) => filteredEntityNames.has(r.from) && filteredEntityNames.has(r.to)
    );

    const filteredGraph: KnowledgeGraph = {
      entities: filteredEntities,
      relations: filteredRelations,
    };

    return filteredGraph;
  }

  // Protected methods - for internal use and experts only

  /**
   * Load the graph from storage
   */
  protected async loadGraph(): Promise<KnowledgeGraph> {
    try {
      const data = await fs.readFile(MEMORY_FILE_PATH, "utf-8");
      const lines = data.split("\n").filter((line) => line.trim() !== "");
      const graph = lines.reduce(
        (graph: KnowledgeGraph, line) => {
          const item = JSON.parse(line);
          if (item.type === "entity") graph.entities.push(item as Entity);
          if (item.type === "relation") graph.relations.push(item as Relation);
          return graph;
        },
        { entities: [], relations: [] }
      );

      // Validate the graph using zod
      return KnowledgeGraphSchema.parse(graph);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as any).code === "ENOENT"
      ) {
        return { entities: [], relations: [] };
      }
      throw error;
    }
  }

  /**
   * Save the graph to storage
   */
  protected async saveGraph(graph: KnowledgeGraph): Promise<void> {
    // Validate the graph before saving
    KnowledgeGraphSchema.parse(graph);

    const lines = [
      ...graph.entities.map((e) => JSON.stringify({ type: "entity", ...e })),
      ...graph.relations.map((r) => JSON.stringify({ type: "relation", ...r })),
    ];
    await fs.writeFile(MEMORY_FILE_PATH, lines.join("\n"));
  }

  /**
   * Create new entities in the graph
   */
  protected async createEntities(entities: Entity[]): Promise<Entity[]> {
    // Validate all entities
    entities.forEach((entity) => EntitySchema.parse(entity));

    const graph = await this.loadGraph();
    const newEntities = entities.filter(
      (e) =>
        !graph.entities.some((existingEntity) => existingEntity.name === e.name)
    );
    graph.entities.push(...newEntities);
    await this.saveGraph(graph);
    return newEntities;
  }

  /**
   * Create new relations in the graph
   */
  protected async createRelations(relations: Relation[]): Promise<Relation[]> {
    // Validate all relations
    relations.forEach((relation) => RelationSchema.parse(relation));

    const graph = await this.loadGraph();
    const newRelations = relations.filter(
      (r) =>
        !graph.relations.some(
          (existingRelation) =>
            existingRelation.from === r.from &&
            existingRelation.to === r.to &&
            existingRelation.relationType === r.relationType
        )
    );
    graph.relations.push(...newRelations);
    await this.saveGraph(graph);
    return newRelations;
  }

  /**
   * Add observations to existing entities
   */
  protected async addObservations(
    observations: { entityName: string; contents: string[] }[]
  ): Promise<{ entityName: string; addedObservations: string[] }[]> {
    const graph = await this.loadGraph();
    const results = observations.map((o) => {
      const entity = graph.entities.find((e) => e.name === o.entityName);
      if (!entity) {
        throw new Error(`Entity with name ${o.entityName} not found`);
      }
      const newObservations = o.contents.filter(
        (content) => !entity.observations.includes(content)
      );
      entity.observations.push(...newObservations);
      return { entityName: o.entityName, addedObservations: newObservations };
    });
    await this.saveGraph(graph);
    return results;
  }

  /**
   * Delete entities from the graph
   */
  protected async deleteEntities(entityNames: string[]): Promise<void> {
    const graph = await this.loadGraph();
    graph.entities = graph.entities.filter(
      (e) => !entityNames.includes(e.name)
    );
    graph.relations = graph.relations.filter(
      (r) => !entityNames.includes(r.from) && !entityNames.includes(r.to)
    );
    await this.saveGraph(graph);
  }

  /**
   * Delete observations from entities
   */
  protected async deleteObservations(
    deletions: { entityName: string; observations: string[] }[]
  ): Promise<void> {
    const graph = await this.loadGraph();
    deletions.forEach((d) => {
      const entity = graph.entities.find((e) => e.name === d.entityName);
      if (entity) {
        entity.observations = entity.observations.filter(
          (o) => !d.observations.includes(o)
        );
      }
    });
    await this.saveGraph(graph);
  }

  /**
   * Delete relations from the graph
   */
  protected async deleteRelations(relations: Relation[]): Promise<void> {
    // Validate all relations
    relations.forEach((relation) => RelationSchema.parse(relation));

    const graph = await this.loadGraph();
    graph.relations = graph.relations.filter(
      (r) =>
        !relations.some(
          (delRelation) =>
            r.from === delRelation.from &&
            r.to === delRelation.to &&
            r.relationType === delRelation.relationType
        )
    );
    await this.saveGraph(graph);
  }
}
