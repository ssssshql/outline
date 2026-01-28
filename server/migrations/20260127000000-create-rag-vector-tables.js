"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        return queryInterface.sequelize.transaction(async (transaction) => {
            // Enable pgvector extension
            await queryInterface.sequelize.query(
                'CREATE EXTENSION IF NOT EXISTS vector;',
                { transaction }
            );

            // Create collections table
            await queryInterface.createTable(
                "rag_collections",
                {
                    uuid: {
                        type: Sequelize.UUID,
                        allowNull: false,
                        primaryKey: true,
                        defaultValue: Sequelize.literal('gen_random_uuid()'),
                    },
                    name: {
                        type: Sequelize.STRING,
                        allowNull: true,
                    },
                    cmetadata: {
                        type: Sequelize.JSONB,
                        allowNull: true,
                    },
                },
                { transaction }
            );

            // Create vectors table
            await queryInterface.createTable(
                "rag_vectors",
                {
                    id: {
                        type: Sequelize.UUID,
                        allowNull: false,
                        primaryKey: true,
                        defaultValue: Sequelize.literal('gen_random_uuid()'),
                    },
                    content: {
                        type: Sequelize.TEXT,
                        allowNull: true,
                    },
                    metadata: {
                        type: Sequelize.JSONB,
                        allowNull: true,
                    },
                    vector: {
                        type: 'vector(1024)',
                        allowNull: true,
                    },
                    collection_id: {
                        type: Sequelize.UUID,
                        allowNull: true,
                        references: {
                            model: "rag_collections",
                            key: "uuid",
                        },
                        onDelete: "CASCADE",
                    },
                },
                { transaction }
            );

            // Create HNSW index for fast similarity search
            await queryInterface.sequelize.query(
                `CREATE INDEX IF NOT EXISTS rag_vectors_vector_idx 
         ON rag_vectors 
         USING hnsw (vector vector_cosine_ops) 
         WITH (m = 16, ef_construction = 64);`,
                { transaction }
            );

            // Create index on collection_id for faster filtering
            await queryInterface.addIndex("rag_vectors", ["collection_id"], {
                transaction,
            });

            // Create GIN index on metadata for faster metadata filtering
            await queryInterface.sequelize.query(
                `CREATE INDEX IF NOT EXISTS rag_vectors_metadata_idx 
         ON rag_vectors 
         USING gin (metadata);`,
                { transaction }
            );
        });
    },

    async down(queryInterface) {
        return queryInterface.sequelize.transaction(async (transaction) => {
            await queryInterface.dropTable("rag_vectors", { transaction });
            await queryInterface.dropTable("rag_collections", { transaction });
            // Note: We don't drop the vector extension as it might be used by other tables
        });
    },
};
