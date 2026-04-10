import { useState } from "react";

import { motion } from "framer-motion";
import { Link } from "react-router";

import styles from "./BlogPage.module.css";
import Seo from "../../components/Global/Seo";
import { BLOG_POSTS } from "../../data/blog-posts";

const BlogPage = () => {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const categories = Array.from(
    new Set(BLOG_POSTS.map((post) => post.category)),
  );

  const filteredPosts = (
    selectedCategory
      ? BLOG_POSTS.filter((post) => post.category === selectedCategory)
      : BLOG_POSTS
  ).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const handleCategoryClick = (category: string | null) => {
    setSelectedCategory(selectedCategory === category ? null : category);
  };

  return (
    <>
      <Seo
        title="Blog"
        description="Stay updated with the latest insights, tutorials, and news from the Bounce ecosystem"
      />
      <div className={`globalPage ${styles.blogPage}`}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <div className={styles.blogHeader}>
            <h1 className={styles.blogTitle}>Blog</h1>
            <p className={styles.blogSubtitle}>
              Stay updated with the latest insights, tutorials, and news from
              the Bounce ecosystem
            </p>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut", delay: 0.2 }}
        >
          <div className={styles.filterContainer}>
            <button
              className={`${styles.filterButton} ${
                selectedCategory === null ? styles.filterButtonActive : ""
              }`}
              onClick={() => handleCategoryClick(null)}
            >
              All Posts
            </button>
            {categories.map((category) => (
              <button
                key={category}
                className={`${styles.filterButton} ${
                  selectedCategory === category ? styles.filterButtonActive : ""
                }`}
                onClick={() => handleCategoryClick(category)}
              >
                {category}
              </button>
            ))}
          </div>
        </motion.div>

        <div className={styles.blogGrid}>
          {filteredPosts.map((post, index) => (
            <motion.div
              key={post.slug}
              className={styles.blogGridItem}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.8,
                ease: "easeOut",
                delay: index * 0.1,
              }}
            >
              <Link to={`/blog/${post.slug}`} className={styles.blogCardLink}>
                <div className={styles.blogCard}>
                  <div className={styles.blogCardHeader}>
                    <span className={styles.blogDate}>
                      {new Date(post.date).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </span>
                    <span className={styles.blogCategory}>{post.category}</span>
                  </div>
                  <h3 className={styles.blogCardTitle}>{post.title}</h3>
                  <p className={styles.blogCardExcerpt}>{post.excerpt}</p>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </>
  );
};

export default BlogPage;
